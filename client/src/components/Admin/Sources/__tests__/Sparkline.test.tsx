import { render } from '@testing-library/react';
import Sparkline from '../Sparkline';

describe('Sparkline', () => {
  it('renders a polyline with the right number of points', () => {
    const { container } = render(
      <Sparkline points={[
        { at: '2026-04-25', count: 10 },
        { at: '2026-04-26', count: 12 },
        { at: '2026-04-27', count: 11 },
      ]} />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const pts = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(pts).toHaveLength(3);
  });

  it('uses red stroke when any decrease appears in the series', () => {
    const { container } = render(
      <Sparkline points={[
        { at: 'a', count: 10 },
        { at: 'b', count: 8 },
      ]} />,
    );
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe('#c0392b');
  });

  it('uses green stroke when the series is non-decreasing', () => {
    const { container } = render(
      <Sparkline points={[
        { at: 'a', count: 10 },
        { at: 'b', count: 10 },
        { at: 'c', count: 12 },
      ]} />,
    );
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe('#1a7f37');
  });

  it('renders an empty placeholder for 0 or 1 points', () => {
    const { container } = render(<Sparkline points={[{ at: 'a', count: 5 }]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.textContent).toContain('—');
  });
});
