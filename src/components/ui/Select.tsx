import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  displayValue?: string;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onValueChange,
  children,
  className,
  triggerClassName,
  displayValue,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open: isOpen, setOpen: setIsOpen }}>
      <div ref={ref} className={cn("relative", className)}>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center justify-between h-8 px-3 text-xs border border-gray-200 dark:border-dark-border rounded-md bg-white dark:bg-dark-bg cursor-pointer hover:border-gray-300 dark:hover:border-dark-border",
            triggerClassName,
          )}
        >
          <span className="truncate">{displayValue || value}</span>
          <ChevronDown className="w-3 h-3 ml-1 flex-shrink-0" />
        </div>
        {isOpen && (
          <div className="absolute z-50 mt-1 w-full min-w-[120px] bg-white dark:bg-dark-bg border border-gray-200 dark:border-dark-border rounded-md shadow-lg overflow-auto max-h-60">
            {children}
          </div>
        )}
      </div>
    </SelectContext.Provider>
  );
};

export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export const SelectItem: React.FC<SelectItemProps> = ({ value, children, className }) => {
  const context = React.useContext(SelectContext);
  if (!context) throw new Error("SelectItem must be used within Select");

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        context.onValueChange(value);
        context.setOpen(false);
      }}
      className={cn(
        "px-3 py-2 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-dark-border",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const SelectContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export const SelectValue: React.FC<{ placeholder?: string }> = ({ placeholder }) => {
  return <span className="text-gray-500">{placeholder}</span>;
};
