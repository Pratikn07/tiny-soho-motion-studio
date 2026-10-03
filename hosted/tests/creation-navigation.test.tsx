// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, renderHook, act, screen, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { CreationShell } from "@/components/creation/CreationShell";
import { useCreation } from "@/components/creation/useCreation";
import { createMockCreationApi } from "@/components/creation/mock-api";
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });
it("saves a rename before switching creations, even inside the autosave delay", async () => {
  const api = createMockCreationApi(); const first = await api.createCreation("First"), next = await api.createCreation("Next");
  window.history.replaceState(null, "", `/?creation=${first.id}`);
  render(<CreationShell api={api}/>);
  const title = await screen.findByRole("textbox", {name:"Creation name"});
  fireEvent.change(title, {target:{value:"Renamed"}}); fireEvent.blur(title);
  fireEvent.click(await screen.findByRole("button", {name:"Next"}));
  await waitFor(() => expect(screen.getByRole("textbox", {name:"Creation name"})).toHaveValue("Next"));
  expect((await api.getCreation(first.id)).document.name).toBe("Renamed");
});
it("keeps the current creation open when its pending save fails", async () => {
  const api = createMockCreationApi(); const first = await api.createCreation("First"); await api.createCreation("Next");
  window.history.replaceState(null, "", `/?creation=${first.id}`); render(<CreationShell api={api}/>);
  const title = await screen.findByRole("textbox", {name:"Creation name"});
  vi.spyOn(api,"saveCreation").mockRejectedValue(new Error("Offline"));
  fireEvent.change(title,{target:{value:"Unsaved"}}); fireEvent.blur(title);
  fireEvent.click(await screen.findByRole("button",{name:"Next"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox",{name:"Creation name"})).toHaveValue("Unsaved");
  expect(new URL(location.href).searchParams.get("creation")).toBe(first.id);
});
it("recovers a session draft only after its creation has been loaded", async () => {
  const api = createMockCreationApi(); const first = await api.createCreation("First");
  const hook = renderHook(() => useCreation(api));
  await act(async()=>{hook.result.current.open(first);});
  await act(async()=>{await hook.result.current.edit(doc=>({...doc,name:"Recovered"}));});
  hook.unmount();
  const reopened = renderHook(()=>useCreation(api));
  await act(async()=>{reopened.result.current.open(await api.getCreation(first.id));});
  expect(reopened.result.current.view?.document.name).toBe("Recovered");
  await act(async()=>{await reopened.result.current.flush();});
  expect((await api.getCreation(first.id)).document.name).toBe("Recovered");
});
it("does not silently replace a newer saved revision with an older session draft", async()=>{
  const api=createMockCreationApi();const first=await api.createCreation("First");
  const hook=renderHook(()=>useCreation(api));
  await act(async()=>{hook.result.current.open(first);await hook.result.current.edit(doc=>({...doc,name:"Old draft"}));});
  hook.unmount();
  const newer=await api.saveCreation(first.id,first.revision,{...first.document,name:"Saved in another tab"});
  const reopened=renderHook(()=>useCreation(api));
  await act(async()=>{reopened.result.current.open(newer);});
  expect(reopened.result.current.view?.document.name).toBe("Saved in another tab");
  expect(reopened.result.current.recoveryDraft?.document.name).toBe("Old draft");
  await act(async()=>{reopened.result.current.discardDraft();});
  expect(reopened.result.current.recoveryDraft).toBeNull();
});

it("asks again if another tab saves after a matching draft is recovered", async()=>{
  const api=createMockCreationApi(); const first=await api.createCreation("First");
  sessionStorage.setItem(`tiny-soho:draft:${first.id}`, JSON.stringify({...first,document:{...first.document,name:"Recovered"}}));
  const hook=renderHook(()=>useCreation(api));
  await act(async()=>{hook.result.current.open(first);});
  await api.saveCreation(first.id,first.revision,{...first.document,name:"Newer save"});
  await act(async()=>{await expect(hook.result.current.flush()).rejects.toThrow("Saved settings changed");});
  expect((await api.getCreation(first.id)).document.name).toBe("Newer save");
  expect(hook.result.current.recoveryDraft?.document.name).toBe("Recovered");
  expect(hook.result.current.view?.document.name).toBe("Newer save");
});
