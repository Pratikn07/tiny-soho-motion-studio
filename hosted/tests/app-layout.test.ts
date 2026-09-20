import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "@/app/layout";

describe("hosted Studio document layout", () => {
  it("wraps the Studio in an English HTML document", () => {
    const markup = renderToStaticMarkup(
      createElement(RootLayout, { children: createElement("p", null, "Studio content") }),
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain("Studio content");
  });
});
