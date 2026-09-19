import RedesignCard from "./RedesignCard";
import type { ReactNode } from "react";

interface RedesignMetricCardProps {
  change?: string;
  className?: string;
  icon?: ReactNode;
  label: string;
  value: string;
}

export default function RedesignMetricCard({
  change,
  className = "",
  icon,
  label,
  value,
}: RedesignMetricCardProps) {
  return (
    <RedesignCard className={`amp-metric-card ${className}`.trim()} hover>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="amp-metric-label">{label}</p>
          <p className="amp-metric-value">{value}</p>
          {change && <p className="amp-metric-change">{change}</p>}
        </div>
        {icon}
      </div>
    </RedesignCard>
  );
}
