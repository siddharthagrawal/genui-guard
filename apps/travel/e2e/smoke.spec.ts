import { expect, test } from "@playwright/test";

/**
 * Verifies the real json-render Renderer, not a walker of our own, and that the
 * guard's decisions survive into what the browser actually paints.
 */

test("replay mode renders agent-composed results through json-render", async ({ page }) => {
  await page.goto("/");

  // Cards are rendered by json-render's Renderer from the guarded spec.
  await expect(page.getByRole("heading", { name: "Flights SFO to Lisbon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Places to stay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book now" })).toBeVisible();

  // Bound props resolved against host data, so a real fare appears.
  await expect(page.getByText("Harbor Air").first()).toBeVisible();

  // The user's view says nothing about guardrails.
  await expect(page.getByText("Inject failures")).toHaveCount(0);
});

test("the developer panel is separate and opt-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Developer view. The user never sees this.")).toHaveCount(0);

  await page.getByRole("button", { name: "genui-guard" }).click();
  await expect(page.getByText("Developer view. The user never sees this.")).toBeVisible();
  await expect(page.getByText("Inject failures")).toBeVisible();
});

test("chaos mode blocks the invented fare, and turning guardrails off reveals it", async ({
  page,
}) => {
  await page.goto("/?dev");

  // Guardrails on: the fabricated $189 card never reaches the page.
  await expect(page.getByRole("heading", { name: "Flights SFO to Lisbon" })).toBeVisible();
  await expect(page.getByText("$189")).toHaveCount(0);

  // The gap is reported at the top of the page, where it cannot be missed.
  await expect(page.getByText(/removed before this page rendered/)).toBeVisible();

  // The full trace counts interventions, and separates them from the allows.
  await page.getByRole("button", { name: /Full trace/ }).click();
  await expect(page.getByText(/\d+ changed, \d+ examined and allowed/)).toBeVisible();
  await expect(page.getByText(/never reached the page/)).toBeVisible();

  // Off: the same recorded output, unchecked. The real input is visually
  // hidden behind a custom switch, so click the label as a user would.
  await page.locator('label:has-text("Guardrails")').click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByText("$189")).toBeVisible();
});

test("a gated booking asks before it acts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Book now" }).click();

  // json-render's own confirmation layer, driven by the confirm field the
  // guard set. Nothing is charged until the user agrees.
  await expect(page.getByText(/confirm/i).first()).toBeVisible();
});

test("each injection reports what it did, one switch at a time", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "genui-guard" }).click();

  // Nothing injected yet, so no outcome badges.
  await expect(page.getByText(/is a literal value written by the model/)).toHaveCount(0);

  // Turn on exactly one failure. Its own row explains the decision, so the
  // effect is readable without diffing two pages by eye.
  await page.getByText("Invented fare").click();
  await expect(page.getByText(/is a literal value written by the model/)).toBeVisible();

  // And the page says what disappeared, rather than silently missing a card.
  await expect(page.getByText(/removed before this page rendered/)).toBeVisible();
  await expect(page.getByText("FlightCard").first()).toBeVisible();
});

test("a repair is surgical: the invented claim goes, the real ones stay", async ({ page }) => {
  await page.goto("/");

  // The one card the claim is injected onto, found by its departure time.
  // Scoping to the card matters: hotels legitimately carry "Free cancellation"
  // of their own, and the query header contains the word "refundable".
  const card = page.locator("article", { hasText: "14:05 to 16:55" });

  // These two come from the fare's own rules, so they must survive.
  await expect(card.getByText("Refundable", { exact: true })).toBeVisible();
  await expect(card.getByText("Bag included", { exact: true })).toBeVisible();
  await expect(card.getByText("Free cancellation", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "genui-guard" }).click();
  await page.getByText("Unsupported claim").click();

  // The unsupported badge never renders, and the supported ones are untouched.
  await expect(card.getByText("Free cancellation", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Refundable", { exact: true })).toBeVisible();
  await expect(card.getByText("Bag included", { exact: true })).toBeVisible();
  await expect(page.getByText(/nothing in the source data supports/)).toBeVisible();

  // A repair changes a prop rather than dropping the card, so there is no gap.
  await expect(page.getByText(/removed before this page rendered/)).toHaveCount(0);

  // With guardrails off, the invented claim appears beside the real ones.
  await page.locator('label:has-text("Guardrails")').click();
  await expect(card.getByText("Free cancellation", { exact: true })).toBeVisible();
  await expect(card.getByText("Refundable", { exact: true })).toBeVisible();
});

test("the trace separates what changed from what was examined and allowed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "genui-guard" }).click();
  await page.getByRole("button", { name: /Full trace/ }).click();

  // A well behaved turn still gates the booking, and allows everything else.
  // The allows matter: they are the only evidence the guard is not simply
  // blocking everything it sees.
  await expect(page.getByText(/\d+ changed, \d+ examined and allowed/)).toBeVisible();

  const reveal = page.getByRole("button", { name: /Show the \d+ examined and allowed/ });
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(page.getByRole("button", { name: /Hide the \d+ allowed/ })).toBeVisible();
});

test("each question gets its own message, and re-running does not duplicate the thread", async ({
  page,
}) => {
  await page.goto("/");

  const userBubbles = page.locator('[class*="bg-slate-900"][class*="rounded-2xl"]');
  const agentBubbles = page.locator('[class*="bg-slate-100"][class*="rounded-2xl"]');

  // The opening question is present from the start, so the panel reads as a
  // conversation rather than a reply with no question.
  await expect(userBubbles).toHaveCount(1);
  await expect(userBubbles.first()).toContainText("Weekend in Lisbon");
  await expect(agentBubbles).toHaveCount(1);

  await page.getByRole("button", { name: /Nonstop from JFK/ }).click();

  // The second question gets its own message, not an agent reply tacked onto
  // the first one.
  await expect(userBubbles).toHaveCount(2);
  await expect(userBubbles.nth(1)).toContainText("Nonstop from JFK");
  await expect(agentBubbles).toHaveCount(2);
  await expect(agentBubbles.nth(1)).toContainText("leaving from JFK");

  // Changing a guardrail re-runs the same question, so the trailing reply is
  // replaced rather than the thread growing.
  await page.getByRole("button", { name: "genui-guard" }).click();
  await page.locator('label:has-text("Guardrails")').click();
  await expect(userBubbles).toHaveCount(2);
  await expect(agentBubbles).toHaveCount(2);
});

test("airline marks and hotel photos render, and the guard can still remove one", async ({
  page,
}) => {
  await page.goto("/");

  // Generated inline SVG, so nothing is fetched and no real brand is borrowed.
  await expect(page.locator('svg[aria-label$="logo"]')).toHaveCount(4);
  await expect(page.locator("article svg[role=img]")).not.toHaveCount(0);
  await expect(page.getByText("photo removed")).toHaveCount(0);

  // The photo is still gated on the URL surviving safeUrls, so stripping an
  // unapproved host visibly removes it rather than being papered over.
  await page.getByRole("button", { name: "genui-guard" }).click();
  await page.getByText("Unsafe URL").click();
  await expect(page.getByText("photo removed")).toHaveCount(1);
});

/**
 * With everything injected at once, three failures land on the same fare card.
 * The panel used to match a switch to a decision by element alone and take
 * whichever finding came first, so "Wrong label" explained itself with the
 * price's reason. Every test above flips one switch, which is exactly why none
 * of them noticed.
 */
test("with every switch on, each row explains its own failure", async ({ page }) => {
  await page.goto("/?dev");

  const wrongLabel = page.getByTestId("outcome-wrongStops");
  const literalPrice = page.getByTestId("outcome-literalPrice");

  await expect(wrongLabel).toBeVisible();
  await expect(literalPrice).toBeVisible();

  // The row about the stop count must talk about stops, not about price.
  await expect(wrongLabel).toContainText(/\.stops\b/);
  await expect(wrongLabel).not.toContainText(/\.price\b/);

  await expect(literalPrice).toContainText(/\.price\b/);
});
