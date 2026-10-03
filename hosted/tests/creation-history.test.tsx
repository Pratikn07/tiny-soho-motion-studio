// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {CreationSidebar} from "@/components/carousel/CreationSidebar";
afterEach(cleanup);
it("searches titles and provides rename and reversible archive actions",async()=>{
  const rename=vi.fn(async()=>{}),archive=vi.fn(async()=>{});
  const creations=[{id:"a",name:"Potty week",updatedAt:new Date().toISOString(),slideCount:1,slidesInProgress:1},{id:"b",name:"Meal prep",updatedAt:new Date().toISOString(),slideCount:2,archivedAt:new Date().toISOString()}];
  const props={creations,activeId:"a",busy:false,onNew:vi.fn(),onOpen:vi.fn(),onRename:rename,onArchive:archive};
  render(<CreationSidebar {...props}/>);
  expect(screen.queryByRole("button",{name:"Meal prep"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox",{name:"Search creations"}),{target:{value:"absent"}});
  expect(screen.queryByRole("button",{name:"Potty week"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:""}});
  fireEvent.click(screen.getByText("Options for Potty week"));
  fireEvent.click(screen.getByRole("button",{name:"Rename"}));
  fireEvent.change(screen.getByRole("textbox",{name:"New creation name"}),{target:{value:"Potty tips"}});
  fireEvent.click(screen.getByRole("button",{name:"Save name"}));
  await waitFor(()=>expect(rename).toHaveBeenCalledWith("a","Potty tips"));
  fireEvent.click(screen.getByRole("button",{name:"Archive"}));
  expect(screen.getByText("Archiving does not cancel generation.")).toBeInTheDocument();
  await waitFor(()=>expect(archive).toHaveBeenCalledWith("a",true));
  fireEvent.click(screen.getByRole("checkbox",{name:"Show archived creations"}));
  fireEvent.click(screen.getByText("Options for Meal prep"));
  fireEvent.click(screen.getByRole("button",{name:"Restore"}));
  await waitFor(()=>expect(archive).toHaveBeenCalledWith("b",false));
});
