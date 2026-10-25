import { useEffect, useRef, useState } from "react";
import {
  loadQueryWorkspace,
  makeQueryTab,
  saveQueryWorkspace,
  type QueryHistoryEntry,
  type QueryWorkspaceState,
  type SavedQuery,
} from "../../../lib/query-workspace";
import type { RailView } from "../workspace-helpers";

/**
 * Workspace tab state: the tab list, the active tab and its query text,
 * the saved-query library and the run history. Owns persistence (debounced
 * save plus a beforeunload flush) and the remember-queries preference.
 * Presentation state the workspace keeps (query name, save dialog, rail
 * view, notices) is reached through callbacks.
 */
export function useWorkspaceTabs({
  queryFolder,
  onNotice,
  onQueryNameChange,
  onSaveDialogChange,
  onRailViewChange,
}: {
  queryFolder: string;
  onNotice: (message: string) => void;
  onQueryNameChange: (name: string) => void;
  onSaveDialogChange: (open: boolean) => void;
  onRailViewChange: (view: RailView) => void;
}) {
  const [workspace, setWorkspace] = useState<QueryWorkspaceState>(() => {
    const loaded = loadQueryWorkspace();
    if (!loaded.tabs.length) {
      const tab = makeQueryTab();
      loaded.tabs = [tab];
      loaded.activeTabId = tab.id;
    } else if (!loaded.activeTabId) loaded.activeTabId = loaded.tabs[0]!.id;
    return loaded;
  });
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  const queryText = activeTab?.query ?? "";
  function setQueryText(query: string): void {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId
          ? { ...tab, query, updatedAt: Date.now() }
          : tab,
      ),
    }));
  }

  const [rememberQueries, setRememberQueries] = useState(() => {
    try {
      return localStorage.getItem("rowfish.remember-query-history") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "rowfish.remember-query-history",
        String(rememberQueries),
      );
    } catch {}
  }, [rememberQueries]);
  const workspaceSnapshot = useRef(workspace);
  workspaceSnapshot.current = workspace;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveQueryWorkspace(workspace))
        onNotice(
          "Workspace could not be saved locally. Export important SQL before closing.",
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workspace]);
  useEffect(() => {
    const flush = (): void => {
      saveQueryWorkspace(workspaceSnapshot.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  function updateHistory(id: string, update: Partial<QueryHistoryEntry>): void {
    setWorkspace((current) => ({
      ...current,
      history: current.history.map((entry) =>
        entry.id === id ? { ...entry, ...update } : entry,
      ),
    }));
  }
  function saveCurrentQuery(): void {
    if (!queryText.trim()) return;
    onQueryNameChange(
      activeTab?.title === "Untitled query" ? "" : (activeTab?.title ?? ""),
    );
    onSaveDialogChange(true);
  }
  function saveQueryToLibrary(title: string): void {
    const item: SavedQuery = {
      id: crypto.randomUUID(),
      title,
      query: queryText,
      kind: activeTab?.kind ?? "postgres",
      connectionKey: activeTab?.connectionKey ?? "",
      folder: queryFolder.trim() || "General",
      updatedAt: Date.now(),
    };
    setWorkspace((current) => ({
      ...current,
      saved: [
        item,
        ...current.saved.filter(
          (entry) => entry.title !== item.title || entry.folder !== item.folder,
        ),
      ].slice(0, 500),
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId ? { ...tab, title } : tab,
      ),
    }));
    onSaveDialogChange(false);
    onRailViewChange("saved");
  }

  return {
    workspace,
    setWorkspace,
    activeTab,
    queryText,
    setQueryText,
    rememberQueries,
    setRememberQueries,
    workspaceSnapshot,
    updateHistory,
    saveCurrentQuery,
    saveQueryToLibrary,
  };
}
