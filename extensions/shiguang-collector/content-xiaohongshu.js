// Xiaohongshu Site Integration

(() => {
  if (!window.location.hostname.includes("xiaohongshu.com")) {
    return;
  }

  if (globalThis.__shiguangCollectorXiaohongshuInitialized) {
    return;
  }
  globalThis.__shiguangCollectorXiaohongshuInitialized = true;

  const collector = globalThis.__shiguangCollector;
  if (!collector) {
    return;
  }

  function injectMenuItem(menuContainer) {
    if (!menuContainer || menuContainer.dataset.shiguangInjected) {
      return;
    }

    menuContainer.dataset.shiguangInjected = "true";

    const menuRect = menuContainer.getBoundingClientRect();
    const menuItem = document.createElement("div");
    menuItem.className = "menu-item";
    menuItem.setAttribute("data-v-26f6a4d9", "");
    menuItem.textContent = "发送到拾光";

    menuItem.addEventListener("click", async (event) => {
      event.stopPropagation();

      let imageUrl = collector.getLastImageUrl();
      let imageTarget = collector.getLastRightClickTarget();

      if (!imageUrl && imageTarget) {
        imageUrl = collector.getImageUrlFromElement(imageTarget);
      }

      if (!imageUrl) {
        const allImages = Array.from(document.querySelectorAll("img")).filter(
          (img) => img.naturalWidth > 100 && img.offsetParent !== null,
        );

        if (allImages.length > 0) {
          let closestImg = null;
          let closestDist = Infinity;

          for (const img of allImages) {
            const rect = img.getBoundingClientRect();
            const imgCenterX = rect.x + rect.width / 2;
            const imgCenterY = rect.y + rect.height / 2;
            const menuCenterX = menuRect.x + menuRect.width / 2;
            const menuCenterY = menuRect.y + menuRect.height / 2;

            const dist = Math.sqrt(
              Math.pow(imgCenterX - menuCenterX, 2) + Math.pow(imgCenterY - menuCenterY, 2),
            );

            if (dist < closestDist) {
              closestDist = dist;
              closestImg = img;
            }
          }

          if (closestImg) {
            imageTarget = closestImg;
            imageUrl = collector.getImageUrlFromElement(closestImg);
          }
        }
      }

      if (!imageUrl) {
        collector.showToast("未找到图片，请右键点击图片后重试", "error");
        return;
      }

      collector.setLastImageContext(imageTarget, imageUrl);
      menuItem.textContent = "正在发送...";

      try {
        const result = await collector.requestCollectImage(imageUrl, {
          missingImageMessage: "未找到图片，请右键点击图片后重试",
        });

        if (result.cancelled) {
          menuItem.textContent = "发送到拾光";
        } else if (result.success) {
          menuItem.textContent = "发送成功";
          setTimeout(() => {
            menuItem.textContent = "发送到拾光";
          }, 1200);
        } else {
          const errorMsg = result.error || "未知错误";
          menuItem.textContent = "发送失败: " + errorMsg;
          collector.showToast("发送失败: " + errorMsg, "error", 3600);
          setTimeout(() => {
            menuItem.textContent = "发送到拾光";
          }, 3000);
        }
      } catch (error) {
        console.error("发送到拾光失败:", error);
        const errorMsg = collector.getErrorMessage(error);
        menuItem.textContent = "发送失败: " + errorMsg;
        collector.showToast("发送失败: " + errorMsg, "error", 3600);
        setTimeout(() => {
          menuItem.textContent = "发送到拾光";
        }, 3000);
      }
    });

    const divider = document.createElement("div");
    divider.style.cssText = "border-top: 1px solid #eee; margin: 4px 0;";

    menuContainer.insertBefore(divider, menuContainer.firstChild);
    menuContainer.insertBefore(menuItem, divider);
  }

  function handleXiaohongshuMenu() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const menuContainer = node.classList?.contains("context-menu-container")
              ? node
              : node.querySelector?.(".context-menu-container");

            if (menuContainer && !menuContainer.dataset.shiguangInjected) {
              injectMenuItem(menuContainer);
            }
          }
        }

        const existingMenus = document.querySelectorAll(
          ".context-menu-container:not([data-shiguang-injected])",
        );
        existingMenus.forEach(injectMenuItem);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleXiaohongshuMenu);
  } else {
    handleXiaohongshuMenu();
  }
})();
