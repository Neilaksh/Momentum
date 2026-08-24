import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Momentum Life Tracker" },
      {
        name: "description",
        content:
          "Sign in to Momentum to track your weekly routine, streaks and long-term goals across every device.",
      },
      { property: "og:title", content: "Sign in — Momentum Life Tracker" },
      {
        property: "og:description",
        content: "Access your synced weekly tracker, streaks, XP and goals.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/" });
  }, [loading, session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
        setMode("signin");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Password reset link sent.");
        setMode("signin");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Momentum
          </span>
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {mode === "signup"
            ? "Create your account"
            : mode === "forgot"
              ? "Reset password"
              : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your week, streaks and goals stay in sync on every device.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              <button className="text-left hover:text-foreground" onClick={() => setMode("signup")}>
                No account? <span className="text-primary">Sign up</span>
              </button>
              <button className="text-left hover:text-foreground" onClick={() => setMode("forgot")}>
                Forgot your password?
              </button>
            </>
          ) : (
            <button className="text-left hover:text-foreground" onClick={() => setMode("signin")}>
              Back to <span className="text-primary">sign in</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
