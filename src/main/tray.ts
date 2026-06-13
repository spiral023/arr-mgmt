import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";

export type TrayController = {
  tray: Tray;
  setSchedulerPaused: (paused: boolean) => void;
};

export function createTray(window: BrowserWindow, actions: { runAnalysis: () => void; pauseScheduler: (paused: boolean) => void }): TrayController {
  let paused = false;
  const tray = new Tray(nativeImage.createEmpty());

  const updateMenu = () => {
    tray.setToolTip("ARR Ops");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show ARR Ops",
          click: () => {
            window.show();
            window.focus();
          },
        },
        {
          label: "Run analysis",
          click: actions.runAnalysis,
        },
        {
          label: paused ? "Resume scheduler" : "Pause scheduler",
          click: () => {
            paused = !paused;
            actions.pauseScheduler(paused);
            updateMenu();
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            app.quit();
          },
        },
      ]),
    );
  };

  updateMenu();

  return {
    tray,
    setSchedulerPaused(nextPaused) {
      paused = nextPaused;
      actions.pauseScheduler(paused);
      updateMenu();
    },
  };
}
