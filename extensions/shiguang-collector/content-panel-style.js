// 拾光采集器 - 页面内面板样式

(() => {
  if (globalThis.__shiguangCollectorPanelStyle) {
    return;
  }

  globalThis.__shiguangCollectorPanelStyle = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      --panel-bg: rgba(250, 250, 249, 0.98);
      width: min(280px, calc(100vw - 28px));
      max-height: min(720px, calc(100vh - 36px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 14px;
      background: var(--panel-bg);
      box-shadow: 0 18px 46px rgba(15, 23, 42, 0.18);
      color: #1f2937;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(18px);
    }
    .panel.wide {
      width: min(430px, calc(100vw - 28px));
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 12px 6px;
      background: var(--panel-bg);
    }
    .brand {
      font-size: 14px;
      font-weight: 400;
    }
    .icon-btn {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #475569;
      cursor: pointer;
      font-size: 18px;
    }
    .icon-btn:hover { background: rgba(15, 23, 42, 0.07); color: #111827; }
    .body {
      min-height: 0;
      overflow: auto;
      padding: 0 12px 12px;
    }
    .actions { display: flex; flex-direction: column; gap: 2px; }
    .action, .plain-row {
      width: 100%;
      min-height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: #111827;
      padding: 0 6px;
    }
    .action {
      cursor: pointer;
      text-align: left;
      font: inherit;
      font-weight: 400;
    }
    .action:hover { background: rgba(15, 23, 42, 0.06); }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 42px;
    }
    .row + .row { margin-top: 10px; }
    .muted { color: #64748b; }
    .button {
      min-height: 34px;
      border: 0;
      border-radius: 999px;
      background: #111827;
      color: #fff;
      cursor: pointer;
      padding: 0 13px;
      font-weight: 400;
    }
    .button.secondary { background: rgba(15, 23, 42, 0.08); color: #1f2937; }
    .button:disabled { cursor: default; opacity: 0.45; }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 -12px 12px;
      padding: 8px 12px 10px;
      background: var(--panel-bg);
      backdrop-filter: blur(18px);
    }
    .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .thumb {
      position: relative;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.08);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
    .check {
      position: absolute;
      top: 7px;
      left: 7px;
      width: 20px;
      height: 20px;
      accent-color: #111827;
    }
    .status {
      position: absolute;
      right: 6px;
      bottom: 6px;
      max-width: calc(100% - 12px);
      padding: 3px 7px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.78);
      color: #fff;
      font-size: 11px;
      white-space: nowrap;
    }
    .field {
      display: grid;
      grid-template-columns: 1fr 110px;
      align-items: center;
      gap: 12px;
      min-height: 42px;
    }
    .field input {
      width: 100%;
      height: 34px;
      border: 0;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.07);
      color: #111827;
      padding: 0 10px;
      outline: none;
    }
    .field input:focus { background: rgba(15, 23, 42, 0.10); }
    .switch {
      width: 46px;
      height: 26px;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.18);
      padding: 3px;
      cursor: pointer;
    }
    .switch span {
      display: block;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #fff;
      transition: transform 0.18s ease;
    }
    .switch.on { background: #111827; }
    .switch.on span { transform: translateX(20px); }
    .empty {
      padding: 34px 8px;
      color: #64748b;
      text-align: center;
    }
    @media (max-width: 460px) {
      .panel { width: min(280px, calc(100vw - 24px)); }
      .panel.wide { width: calc(100vw - 24px); }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
})();
