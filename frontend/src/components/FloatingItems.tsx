import type { FC } from 'react';
import { floatingIllustrations } from '@/components/svg/FloatingIllustrationRegistry';

export const FloatingItems: FC = () => (
  <div className="floating-items-container">
    {floatingIllustrations.map(({ Component, id }, index) => (
      <div key={id} className={`floating-item floating-item-${index}`}>
        <Component />
      </div>
    ))}
  </div>
);

export default FloatingItems;
