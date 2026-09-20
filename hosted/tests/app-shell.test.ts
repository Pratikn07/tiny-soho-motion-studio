import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("hosted Studio app shell", () => {
  it("shows an owner sign-in invitation", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain("Tiny Soho Motion Studio");
    expect(markup).toContain("Sign in to create typography-safe motion.");
  });
});
