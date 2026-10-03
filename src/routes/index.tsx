import { createFileRoute } from "@tanstack/react-router";
import { ReaderApp } from "@/components/reader-app";
import { AppSecurity } from "@/components/app-security";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <AppSecurity>
      <ReaderApp />
    </AppSecurity>
  );
}
