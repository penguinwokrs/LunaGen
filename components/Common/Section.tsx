import React, { type ReactNode } from "react"

interface SectionProps {
    title: string
    children: ReactNode
    style?: React.CSSProperties
}

export const Section = ({ title, children, style }: SectionProps) => (
    <section style={{
        marginBottom: "30px",
        padding: "15px",
        backgroundColor: "#f9f9f9",
        borderRadius: "8px",
        ...style
    }}>
        <h2 style={{ fontSize: "1.2rem", marginTop: 0 }}>{title}</h2>
        {children}
    </section>
)
