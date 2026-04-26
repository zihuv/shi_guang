export type AiMetadataAnalysisField = "filename" | "tags" | "description" | "rating";

export interface AiMetadataAnalysisFieldConfig {
  enabled: boolean;
  prompt: string;
}

export type AiMetadataAnalysisConfig = Record<
  AiMetadataAnalysisField,
  AiMetadataAnalysisFieldConfig
>;

export const AI_METADATA_FIELDS: AiMetadataAnalysisField[] = [
  "filename",
  "tags",
  "description",
  "rating",
];

export const DEFAULT_AI_METADATA_ANALYSIS: AiMetadataAnalysisConfig = {
  filename: {
    enabled: true,
    prompt:
      '为图片生成文件名，不含扩展名。\n命名规则：项目代号-类型。\n项目代号能从已有信息或图片内容推断时使用；无法判断时使用“未分类”。\n类型用 2 到 6 个字概括素材类型，例如：海报、图标、截图、参考图、包装、界面、插画。\n避免使用文件系统非法字符：/ \\ : * ? " < > |。\n长度不超过 50 个中文字符。',
  },
  tags: {
    enabled: true,
    prompt:
      "生成不超过 5 个标签。\n标签只描述风格和用途，不要包含过细的物体清单。\n优先复用已有标签中合适的标签，避免新增同义重复标签。\n标签应简短，例如：极简、复古、品牌、社媒、参考、UI、活动物料。\n不要输出空泛标签，例如：图片、素材、好看、高清、角色。",
  },
  description: {
    enabled: true,
    prompt:
      "生成一段简短备注，用 1 到 2 句话说明图片内容、视觉特点和适合用途。\n语气客观，不要夸张营销。\n如果已有备注准确，可以保留核心意思并润色。\n不要编造品牌、人物、地点、版权或不可见信息。",
  },
  rating: {
    enabled: false,
    prompt:
      "为图片给出 1 到 5 分的整数评价。\n1 分：质量差、内容不清晰或几乎不可用。\n2 分：可识别但质量一般，用途有限。\n3 分：正常可用，内容清楚。\n4 分：质量较好，有明确风格或用途。\n5 分：质量优秀，构图、清晰度、风格和复用价值都较高。",
  },
};
