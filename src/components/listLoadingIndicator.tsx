import motionStyles from './listMotion.module.css';

export function ListLoadingIndicator({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <span className={motionStyles.indicator}>
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
