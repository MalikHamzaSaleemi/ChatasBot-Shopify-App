import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Return a clean 404 for any unknown route without logging a full stack trace
  return new Response("Not Found", { status: 404 });
};

export default function CatchAll() {
  return null;
}
