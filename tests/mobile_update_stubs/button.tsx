import React from "react"

export function Button({ children, leftIcon, type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { leftIcon?: React.ReactNode, intent?: string }) {
    return <button type={type || "button"} {...props}>{leftIcon}{children}</button>
}
