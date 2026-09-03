import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/today")({
  beforeLoad: () => {
    throw redirect({
      to: "/",
      // "/" route declares a (tolerated-empty) subjectId search param; provide
      // it explicitly to satisfy exactOptionalPropertyTypes.
      search: { subjectId: undefined } as { subjectId: string | undefined },
    });
  },
  component: () => null,
});
