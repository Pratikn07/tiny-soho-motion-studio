// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { HostedStudio } from "@/components/HostedStudio";

const harness = vi.hoisted(() => ({
  getSession: vi.fn(), authorize: vi.fn(), signOut: vi.fn(), unsubscribe: vi.fn(),
  onChange: null as null | ((_event: string, session: Session | null) => void),
}));
vi.mock("@/lib/supabase-browser", () => ({ createBrowserSupabaseClient: () => ({ auth: {
  getSession: harness.getSession, signOut: harness.signOut,
  onAuthStateChange: (callback: typeof harness.onChange) => {
    harness.onChange = callback;
    return { data: { subscription: { unsubscribe: harness.unsubscribe } } };
  },
} }) }));
vi.mock("@/lib/api", () => ({ createStudioApi: () => ({ authorize: harness.authorize }) }));
vi.mock("@/components/StudioShell", () => ({ StudioShell: ({ onSignOut }: { onSignOut: () => void }) => <section aria-label="Owner workspace"><button onClick={onSignOut}>Sign out</button></section> }));
const session = { access_token: "owner-session", user: { id: "owner" } } as Session;
beforeEach(() => {
  vi.clearAllMocks();
  harness.getSession.mockResolvedValue({ data: { session } });
  harness.authorize.mockResolvedValue(undefined);
  harness.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("hosted Carousel access", () => {
  it("shows login without loading the workspace for signed-out visitors", async () => {
    harness.getSession.mockResolvedValue({ data: { session: null } });
    render(<HostedStudio />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
    expect(harness.authorize).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Owner workspace" })).toBeNull();
  });
  it("waits for the server owner check before opening the workspace", async () => {
    let allow!: () => void;
    harness.authorize.mockImplementation(() => new Promise<void>((resolve) => { allow = resolve; }));
    render(<HostedStudio />);
    await screen.findByText("Checking Studio access…");
    expect(screen.queryByRole("region", { name: "Owner workspace" })).toBeNull();
    await act(async () => allow());
    expect(await screen.findByRole("region", { name: "Owner workspace" })).toBeVisible();
  });
  it("rejects a signed-in non-owner and supports retry", async () => {
    harness.authorize.mockRejectedValueOnce(new Error("Studio access is not available for this account."));
    render(<HostedStudio />);
    expect(await screen.findByRole("alert")).toHaveTextContent("not available");
    expect(screen.queryByRole("region", { name: "Owner workspace" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Owner workspace" })).toBeVisible();
  });
  it("removes the workspace after sign-out and unsubscribes on unmount", async () => {
    const { unmount } = render(<HostedStudio />);
    await screen.findByRole("region", { name: "Owner workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(harness.signOut).toHaveBeenCalledWith({ scope: "local" }));
    act(() => harness.onChange!("SIGNED_OUT", null));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Owner workspace" })).toBeNull();
    unmount();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not keep the owner's workspace when a different session is rejected", async () => {
    render(<HostedStudio />);
    await screen.findByRole("region", { name: "Owner workspace" });
    harness.authorize.mockRejectedValue(new Error("Access denied"));
    act(() => harness.onChange!("SIGNED_IN", { ...session, access_token: "other-session", user: { ...session.user, id: "other" } }));
    expect(screen.queryByRole("region", { name: "Owner workspace" })).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  });
});
