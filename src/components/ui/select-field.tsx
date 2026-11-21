import { Children, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export function SelectField({ value, onValueChange, children, disabled, ...props }: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const empty = useId();
  const options = Children.toArray(children).filter((child): child is ReactElement<{ value: string; children: ReactNode; disabled?: boolean }> => isValidElement(child) && child.type === 'option');
  return (
    <Select value={value || empty} disabled={disabled || !options.length} onValueChange={(next) => onValueChange(next === empty ? '' : next)}>
      <SelectTrigger {...props} className="w-full min-w-0 bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map(({ key, props: option }) => (
          <SelectItem key={key} value={option.value || empty} disabled={option.disabled}>{option.children}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
