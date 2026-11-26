import { Skeleton } from 'antd';
import type { MaterialPricingView } from './materialPricingNavigation';
import pricingStyles from './materialPricingPage.module.css';

export function MaterialPricingSkeleton({
  view,
  label,
}: {
  view: Exclude<MaterialPricingView, 'purchases' | 'analytics'>;
  label: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <div aria-hidden="true">
        {view === 'overview' ? (
          <>
            <div className={`${pricingStyles.metrics} ${pricingStyles.overviewMetrics}`}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={pricingStyles.metric}>
                  <Skeleton.Input active block style={{ width: '55%', minWidth: 0, height: 16 }} />
                  <Skeleton.Input active block style={{ width: '75%', minWidth: 0, height: 24 }} />
                </div>
              ))}
            </div>
            <div className={pricingStyles.publish}>
              <div className={pricingStyles.skeletonPrice}>
                <Skeleton.Input
                  active
                  size="small"
                  style={{ width: 96, minWidth: 0, height: 16 }}
                />
                <Skeleton.Input active block style={{ width: 180, minWidth: 0 }} />
              </div>
              <Skeleton.Button active style={{ width: 100 }} />
              <Skeleton.Input
                active
                className={pricingStyles.skeletonHelp}
                style={{ width: '100%', height: 14 }}
              />
            </div>
            <Skeleton.Input active block style={{ height: 48 }} />
          </>
        ) : (
          <div className={pricingStyles.skeletonTable}>
            <div
              className={pricingStyles.skeletonTableBody}
              style={{
                gridTemplateColumns: `repeat(${view === 'history' ? 3 : 5}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: 7 }, (_, row) => (
                <div key={row} className={pricingStyles.skeletonRow}>
                  {Array.from({ length: view === 'history' ? 3 : 5 }, (_, column) => (
                    <Skeleton.Input
                      key={column}
                      active
                      block
                      size="small"
                      style={{ width: column === 0 ? '80%' : '60%', minWidth: 0, height: 16 }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
