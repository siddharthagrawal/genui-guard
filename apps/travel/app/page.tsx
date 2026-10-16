import { Demo } from "../components/Demo";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string; mode?: string }>;
}) {
  const params = await searchParams;
  // ?dev opens the developer panel with every failure injected. Without it you
  // get the user's view, which is the point of the separation.
  const devOpen = params.dev !== undefined || params.mode === "chaos";
  return <Demo devOpen={devOpen} />;
}
