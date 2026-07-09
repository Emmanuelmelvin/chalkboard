import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  className = '',
  ...props
}) => {
  let variantClass = '';
  if (variant === 'primary') variantClass = 'btn-primary';
  else if (variant === 'secondary') variantClass = 'btn-secondary';
  else if (variant === 'icon') variantClass = 'btn-icon';

  return (
    <button className={`${variantClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

export default Button;
