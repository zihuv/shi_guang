import { defineConfig } from "@rspress/core";

export default defineConfig({
  root: "docs",
  title: "拾光",
  description: "为设计师而生的本地素材管理工具",
  outDir: ".rspress/build",
  base: "/shiguang/",
  icon: "/icon.ico",
  themeConfig: {
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/zihuv/shiguang",
      },
    ],
    nav: [
      { text: "首页", link: "/" },
      {
        text: "指南",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "核心能力", link: "/guide/core-features" },
          { text: "筛选与排序", link: "/guide/filter-and-sort" },
          { text: "视图与布局", link: "/guide/view-modes" },
          { text: "智能集合", link: "/guide/smart-collections" },
          { text: "预览与详情", link: "/guide/preview" },
          { text: "自然语言搜索", link: "/guide/visual-search" },
          { text: "AI 批量分析", link: "/guide/ai-batch-analyze" },
          { text: "设置", link: "/guide/settings" },
          { text: "浏览器扩展", link: "/guide/browser-extension" },
          { text: "浏览器扩展", link: "/guide/browser-extension" },
          { text: "采集与数据", link: "/guide/collection-and-storage" },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "入门",
          items: [{ text: "快速开始", link: "/guide/getting-started" }],
        },
        {
          text: "浏览与管理",
          items: [
            { text: "核心能力", link: "/guide/core-features" },
            { text: "筛选与排序", link: "/guide/filter-and-sort" },
            { text: "视图与布局", link: "/guide/view-modes" },
            { text: "智能集合", link: "/guide/smart-collections" },
            { text: "预览与详情", link: "/guide/preview" },
          ],
        },
        {
          text: "搜索与 AI",
          items: [
            { text: "自然语言搜索", link: "/guide/visual-search" },
            { text: "AI 批量分析", link: "/guide/ai-batch-analyze" },
          ],
        },
        {
          text: "配置与数据",
          items: [
            { text: "设置", link: "/guide/settings" },
            { text: "浏览器扩展", link: "/guide/browser-extension" },
            { text: "采集与数据", link: "/guide/collection-and-storage" },
          ],
        },
      ],
    },
  },
});
