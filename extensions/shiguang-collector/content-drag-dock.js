// Content Script Drag Dock

(() => {
  if (globalThis.__shiguangCollectorDragDock) {
    return;
  }

  const collector = globalThis.__shiguangCollector;
  if (!collector) {
    return;
  }

  const DRAG_DOCK_ID = 'shiguang-drag-dock';
  const DRAG_DOCK_HIDE_DELAY = 140;
  const DRAG_DOCK_REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let dragDockRefs = null;
  let dragDockHideTimer = 0;
  let dragDockHoverDepth = 0;
  let dragDockVisible = false;
  let dragDockSending = false;
  let currentDragImageUrl = null;
  let currentDragReferer = null;

  function clearDragDockHideTimer() {
    if (!dragDockHideTimer) {
      return;
    }

    window.clearTimeout(dragDockHideTimer);
    dragDockHideTimer = 0;
  }

  function ensureDragDock() {
    if (dragDockRefs?.root?.isConnected) {
      return dragDockRefs;
    }

    const root = document.createElement('div');
    root.id = DRAG_DOCK_ID;
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = [
      'position: fixed',
      'left: 0',
      'right: 0',
      'bottom: 20px',
      'display: flex',
      'justify-content: center',
      'padding: 0 12px',
      'z-index: 2147483646',
      'pointer-events: none'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 12px',
      'width: min(420px, calc(100vw - 24px))',
      'padding: 14px 16px',
      'border-radius: 18px',
      'border: 1px solid rgba(255, 255, 255, 0.16)',
      'background: rgba(17, 24, 39, 0.90)',
      'box-shadow: 0 20px 40px rgba(15, 23, 42, 0.24)',
      'backdrop-filter: blur(16px)',
      'color: #f8fafc',
      'font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'cursor: copy',
      'opacity: 0',
      'transform: translateY(18px) scale(0.98)',
      `transition: ${DRAG_DOCK_REDUCED_MOTION ? 'none' : 'opacity 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease'}`,
      'pointer-events: none'
    ].join(';');

    const badge = document.createElement('div');
    badge.setAttribute('aria-hidden', 'true');
    badge.style.cssText = [
      'width: 34px',
      'height: 34px',
      'border-radius: 12px',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'border: 1px solid rgba(212, 175, 55, 0.24)',
      'background: rgba(212, 175, 55, 0.16)',
      'color: #f8fafc',
      'font-size: 18px',
      'font-weight: 700',
      'flex-shrink: 0'
    ].join(';');
    badge.textContent = '+';

    const textWrap = document.createElement('div');
    textWrap.style.cssText = [
      'display: flex',
      'min-width: 0',
      'flex: 1',
      'flex-direction: column',
      'gap: 2px'
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = [
      'font-size: 14px',
      'font-weight: 600',
      'color: #ffffff',
      'white-space: nowrap',
      'overflow: hidden',
      'text-overflow: ellipsis'
    ].join(';');

    const subtitle = document.createElement('div');
    subtitle.style.cssText = [
      'font-size: 12px',
      'color: rgba(248, 250, 252, 0.76)'
    ].join(';');

    textWrap.appendChild(title);
    textWrap.appendChild(subtitle);
    card.appendChild(badge);
    card.appendChild(textWrap);
    root.appendChild(card);

    card.addEventListener('dragenter', (event) => {
      const imageUrl = currentDragImageUrl || collector.extractImageUrlFromDragEvent(event);
      if (!imageUrl) {
        return;
      }

      event.preventDefault();
      clearDragDockHideTimer();
      dragDockHoverDepth += 1;
      currentDragImageUrl = imageUrl;
      syncDragDock();
    });

    card.addEventListener('dragover', (event) => {
      const imageUrl = currentDragImageUrl || collector.extractImageUrlFromDragEvent(event);
      if (!imageUrl) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }

      clearDragDockHideTimer();
      currentDragImageUrl = imageUrl;
      dragDockVisible = true;
      dragDockHoverDepth = Math.max(1, dragDockHoverDepth);
      syncDragDock();
    });

    card.addEventListener('dragleave', () => {
      dragDockHoverDepth = Math.max(0, dragDockHoverDepth - 1);
      syncDragDock();
    });

    card.addEventListener('drop', async (event) => {
      const imageUrl =
        currentDragImageUrl ||
        collector.extractImageUrlFromDragEvent(event) ||
        collector.getLastImageUrl();

      event.preventDefault();
      event.stopPropagation();
      clearDragDockHideTimer();
      dragDockHoverDepth = 0;

      if (!imageUrl) {
        hideDragDock(true);
        collector.showToast('未找到可采集的图片', 'error', 3200);
        return;
      }

      dragDockSending = true;
      currentDragImageUrl = imageUrl;
      syncDragDock();

      try {
        const result = await collector.requestCollectImage(imageUrl, {
          referer: currentDragReferer || window.location.href,
          missingImageMessage: '未找到可采集的图片',
          notifyOnSuccess: true,
          successMessage: '已发送到拾光'
        });

        if (!result.success) {
          throw new Error(result.error || '未知错误');
        }
      } catch (error) {
        console.error('拖拽发送到拾光失败:', error);
        collector.showToast('发送失败: ' + collector.getErrorMessage(error), 'error', 3600);
      } finally {
        hideDragDock(true);
      }
    });

    (document.body || document.documentElement).appendChild(root);

    dragDockRefs = { root, card, badge, title, subtitle };
    syncDragDock();
    return dragDockRefs;
  }

  function syncDragDock() {
    const { root, card, badge, title, subtitle } = ensureDragDock();
    const isActive = dragDockHoverDepth > 0;

    root.setAttribute('aria-hidden', dragDockVisible ? 'false' : 'true');
    card.style.opacity = dragDockVisible ? '1' : '0';
    card.style.transform = dragDockVisible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.98)';
    card.style.pointerEvents = dragDockVisible && !dragDockSending ? 'auto' : 'none';
    card.style.background = isActive ? 'rgba(15, 23, 42, 0.97)' : 'rgba(17, 24, 39, 0.90)';
    card.style.borderColor = isActive ? '#d4af37' : 'rgba(255, 255, 255, 0.16)';
    card.style.boxShadow = isActive
      ? '0 24px 48px rgba(15, 23, 42, 0.32), 0 0 0 1px rgba(212, 175, 55, 0.26)'
      : '0 20px 40px rgba(15, 23, 42, 0.24)';

    badge.textContent = dragDockSending ? '...' : '+';
    badge.style.background = isActive ? '#d4af37' : 'rgba(212, 175, 55, 0.16)';
    badge.style.borderColor = isActive ? '#d4af37' : 'rgba(212, 175, 55, 0.24)';
    badge.style.color = isActive ? '#171717' : '#f8fafc';

    if (dragDockSending) {
      title.textContent = '正在发送到拾光...';
      subtitle.textContent = '复用现有采集接口';
      return;
    }

    if (isActive) {
      title.textContent = '松开发送到拾光';
      subtitle.textContent = '释放鼠标后立即发送';
      return;
    }

    title.textContent = '拖到这里发送到拾光';
    subtitle.textContent = '仅在拖动可采集图片时出现';
  }

  function showDragDock(imageUrl, referer = window.location.href) {
    clearDragDockHideTimer();
    dragDockHoverDepth = 0;
    dragDockVisible = true;
    dragDockSending = false;
    currentDragImageUrl = imageUrl;
    currentDragReferer = referer;
    syncDragDock();
  }

  function hideDragDock(force = false) {
    clearDragDockHideTimer();

    if (dragDockSending && !force) {
      return;
    }

    dragDockVisible = false;
    dragDockHoverDepth = 0;
    dragDockSending = false;
    currentDragImageUrl = null;
    currentDragReferer = null;
    syncDragDock();
  }

  function scheduleDragDockHide(delay = DRAG_DOCK_HIDE_DELAY) {
    clearDragDockHideTimer();
    dragDockHideTimer = window.setTimeout(() => {
      hideDragDock();
    }, delay);
  }

  globalThis.__shiguangCollectorDragDock = {
    showDragDock,
    hideDragDock,
    scheduleHide: scheduleDragDockHide
  };
})();
