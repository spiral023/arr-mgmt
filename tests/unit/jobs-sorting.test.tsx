import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsView } from "../../src/renderer/views/JobsView";
import type { JobView } from "../../src/shared/ipc-contracts";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "arrOps"); });

const job = (name: string, startedAt?: string, finishedAt?: string): JobView => ({
  id: name, name, kind: "analysis", target: "sonarr", status: startedAt ? "completed" : "queued",
  progressCurrent: 1, progressTotal: 1, successCount: 1, failureCount: 0,
  createdAt: startedAt ?? "2026-11-02T10:00:00Z", startedAt, finishedAt,
});

function showJobs(jobs: JobView[]) {
  Object.defineProperty(window, "arrOps", { configurable: true, value: {
    invoke: vi.fn(async (channel: string) => channel === "jobs:list" ? jobs : []), onJobEvent: () => () => {},
  } });
  const { container } = render(<JobsView />);
  return () => [...container.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);
}

describe("Jobs date and duration sorting", () => {
  it("sorts Started by full timestamps across years and months in both directions, with missing dates last", async () => {
    const order = showJobs([
      job("June", "2026-06-28T10:00:00Z"), job("Queued"),
      job("October early", "2026-10-20T10:00:01Z"), job("Previous year", "2025-12-31T10:00:00Z"),
      job("November", "2026-11-01T10:00:00Z"), job("October late", "2026-10-20T10:00:59Z"),
    ]);
    await waitFor(() => expect(order()).toEqual(["November", "October late", "October early", "June", "Previous year", "Queued"]));
    fireEvent.click(screen.getByRole("button", { name: /Started/ }));
    await waitFor(() => expect(order()).toEqual(["Previous year", "June", "October early", "October late", "November", "Queued"]));
    fireEvent.change(screen.getByPlaceholderText("Filter jobs"), { target: { value: "2026" } });
    await waitFor(() => expect(order()).toEqual(["June", "October early", "October late", "November"]));
  });

  it("sorts Finished chronologically with unfinished jobs last in either direction", async () => {
    const order = showJobs([
      job("June", "2026-06-28T10:00:00Z", "2026-06-28T11:00:00Z"),
      job("Unfinished", "2026-10-20T10:00:00Z"),
      job("October", "2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z"),
    ]);
    await screen.findByText("October", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(order()).toEqual(["October", "June", "Unfinished"]));
    fireEvent.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(order()).toEqual(["June", "October", "Unfinished"]));
  });

  it("sorts durations numerically above 99 minutes and keeps unknown durations last", async () => {
    const start = "2026-10-20T10:00:00Z";
    const order = showJobs([
      job("Short", start, "2026-10-20T10:09:00Z"), job("Unknown"),
      job("Hundred minutes", start, "2026-10-20T11:40:00Z"),
      job("Ninety minutes", start, "2026-10-20T11:30:00Z"),
    ]);
    await screen.findByText("Hundred minutes", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /Duration/ }));
    await waitFor(() => expect(order()).toEqual(["Hundred minutes", "Ninety minutes", "Short", "Unknown"]));
    fireEvent.click(screen.getByRole("button", { name: /Duration/ }));
    await waitFor(() => expect(order()).toEqual(["Short", "Ninety minutes", "Hundred minutes", "Unknown"]));
    fireEvent.change(screen.getByPlaceholderText("Filter jobs"), { target: { value: "100:00" } });
    await waitFor(() => expect(order()).toEqual(["Hundred minutes"]));
  });
});
