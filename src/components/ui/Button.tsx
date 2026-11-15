'use client';

import React from 'react';

export type ButtonVariant = 'primary' | 'alt' | 'red' | 'green' | 'blue';
export type ButtonSize = 'md' | 'big' | 'icon';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_MAP: Record<ButtonVariant, string> = {
  primary: '',
  alt: 'alt',
  red: 'red',
  green: 'green',
  blue: 'blue',
};

const SIZE_MAP: Record<ButtonSize, string> = {
  md: '',
  big: 'big',
  icon: 'icon',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', VARIANT_MAP[variant], SIZE_MAP[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={classes}
      {...rest}
    >
      {children}
    </button>
  );
}
