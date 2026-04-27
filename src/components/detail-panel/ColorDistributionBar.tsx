import type { FileItem } from "@/stores/fileTypes";

interface ColorDistributionBarProps {
  colors: NonNullable<FileItem["colorDistribution"]>;
}

export function ColorDistributionBar({ colors }: ColorDistributionBarProps) {
  if (colors.length === 0) {
    return null;
  }

  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-black/[0.035] dark:bg-white/[0.04]">
      <div className="flex w-full h-full">
        {colors.map((colorInfo, index) => (
          <div
            key={index}
            className="h-full relative group cursor-pointer"
            style={{
              width: `${colorInfo.percentage}%`,
              minWidth: colorInfo.percentage > 0 ? "4px" : "0",
            }}
          >
            <div className="absolute inset-0" style={{ backgroundColor: colorInfo.color }} />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
              {colorInfo.color} {colorInfo.percentage.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
