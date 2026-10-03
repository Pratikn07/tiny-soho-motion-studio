// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { ModelPanel } from "@/components/creation/model/ModelPanel";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationShell } from "@/components/creation/CreationShell";
import { createMockCreationApi } from "@/components/creation/mock-api";
afterEach(()=>{cleanup();sessionStorage.clear();});
it("offers progress instead of another generation for an active slide", async()=>{
  const creation=structuredClone(contractFixtures.creation), slide=creation.document.slides[0];
  const api=createMockCreationApi(); const original=api.fetchJson;
  api.fetchJson=vi.fn(async(path,init)=>path.startsWith("/api/runs/") ? {run:{...contractFixtures.runGenerating.run,id:slide.latestRunId}} : path.startsWith("/api/catalog") ? contractFixtures.catalog : path === "/api/budget" ? contractFixtures.budget : original(path,init));
  render(<ModelPanel creation={creation} slide={slide} ready api={api} edit={()=>{}} editSlide={()=>{}} saveServerStep={async()=>{}} onViewResults={()=>{}}/>);
  await screen.findByRole("button",{name:"View generation progress"});
  expect(screen.queryByRole("button",{name:"Generate this slide"})).not.toBeInTheDocument();
  expect(screen.getByText(/This slide is already generating/)).toBeInTheDocument();
});
it("offers Motion, Text, Review and Results in order with a named main heading",async()=>{
  const api=createMockCreationApi({seed:true});const [first]=await api.listCreations();
  window.history.replaceState(null,"",`/?creation=${first.id}`);render(<CreationShell api={api}/>);
  await screen.findByRole("textbox",{name:"Creation name"});
  expect(screen.getByRole("heading",{level:1})).toHaveTextContent(first.name);
  fireEvent.click(screen.getByRole("tab",{name:/Motion/}));
  expect(screen.getByRole("region",{name:"Motion"})).toBeVisible();
  expect(screen.queryByRole("region",{name:"Video model"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Next: Text"}));
  expect(screen.getByRole("region",{name:"Text animation"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Next: Review"}));
  expect(screen.getByRole("region",{name:"Video model"})).toBeVisible();
});
