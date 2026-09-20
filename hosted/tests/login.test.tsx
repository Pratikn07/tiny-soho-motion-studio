// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Login } from "@/components/Login";

describe("hosted Studio sign-in", () => {
  it("passes the supplied credentials to the existing Supabase Auth flow", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    render(<Login onSignIn={signIn} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "owner@tinysoho.test" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "not-a-real-password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(signIn).toHaveBeenCalledWith("owner@tinysoho.test", "not-a-real-password");
  });
});
