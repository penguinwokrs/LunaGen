import React, { useEffect, useRef, useState } from "react"

/**
 * 日本語入力（IME）を壊さないテキスト入力。
 *
 * 設定画面の入力は `useStorage` に直結しているため、1文字ごとに chrome.storage を
 * 往復する。素の制御入力（`value={props.value}`）にすると、変換確定前に非同期で
 * 返ってきた古い値で再描画されて**変換が中断される**（2026-08-02 にユーザー報告）。
 *
 * ここでは描画をローカルの下書きで行い、親へは onChange で伝えるだけにする。
 * 親から来た値は「入力中でないとき」だけ取り込む（外部リセット等を反映するため）。
 */
interface ImeSafeFieldProps {
    value: string
    onChange: (value: string) => void
    multiline?: boolean
    rows?: number
    placeholder?: string
    style?: React.CSSProperties
}

export const ImeSafeField = ({
    value,
    onChange,
    multiline,
    rows,
    placeholder,
    style
}: ImeSafeFieldProps) => {
    const [draft, setDraft] = useState(value)
    const focusedRef = useRef(false)

    // 入力中に外から上書きすると変換が壊れるので、フォーカスが外れているときだけ同期する
    useEffect(() => {
        if (!focusedRef.current) setDraft(value)
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setDraft(e.target.value)
        onChange(e.target.value)
    }

    const shared = {
        value: draft,
        onChange: handleChange,
        onFocus: () => {
            focusedRef.current = true
        },
        onBlur: () => {
            focusedRef.current = false
            setDraft(value)
        },
        placeholder,
        style
    }

    return multiline ? <textarea {...shared} rows={rows} /> : <input type="text" {...shared} />
}
