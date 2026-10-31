import { useNakamaSendChatMessage } from "@/api/hooks/nakama.hooks"
import { PhoneSheet } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { TextInput } from "@/components/ui/text-input"
import { tr, useTr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { WSEvents } from "@/lib/server/ws-events"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { BiChevronDown, BiChevronUp } from "react-icons/bi"
import { HiOutlineChatBubbleLeftRight } from "react-icons/hi2"
import { IoSend } from "react-icons/io5"
import { useNakamaWatchParty } from "./nakama-manager"
import { useWideScreen } from "./use-wide-screen"
import "./nakama-phone.css"

type ChatMessage = {
    peerId: string
    username: string
    message: string
    timestamp: string
    messageId: string
}

const log = logger("NAKAMA WATCH PARTY CHAT")

const watchPartyChat_chatMessagesAtom = atom<ChatMessage[]>([])
const watchPartyChat_chatMinimizedAtom = atom<boolean>(true)
const watchPartyChat_unreadCountAtom = atom<number>(0)

export function NakamaWatchPartyChatProvider() {
    const { watchPartySession, currentUserPeerId } = useNakamaWatchParty()
    const setMessages = useSetAtom(watchPartyChat_chatMessagesAtom)
    const minimized = useAtomValue(watchPartyChat_chatMinimizedAtom)
    const setUnreadCount = useSetAtom(watchPartyChat_unreadCountAtom)

    useWebsocketMessageListener<ChatMessage>({
        type: WSEvents.NAKAMA_WATCH_PARTY_CHAT_MESSAGE,
        onMessage: (data) => {
            setMessages(prev => [...prev, data])
            if (minimized && data.peerId !== currentUserPeerId) {
                setUnreadCount(prev => prev + 1)
            }
        },
    })

    React.useEffect(() => {
        if (!watchPartySession) {
            setMessages([])
            setUnreadCount(0)
        }
    }, [watchPartySession, setMessages, setUnreadCount])

    return null
}

export function NakamaWatchPartyChat() {
    const { watchPartySession, isParticipant, currentUserPeerId } = useNakamaWatchParty()
    const [messages, setMessages] = useAtom(watchPartyChat_chatMessagesAtom)
    const [minimized, setMinimized] = useAtom(watchPartyChat_chatMinimizedAtom)
    const [unreadCount, setUnreadCount] = useAtom(watchPartyChat_unreadCountAtom)
    const [inputValue, setInputValue] = React.useState("")
    const messagesEndRef = React.useRef<HTMLDivElement>(null)
    const chatContainerRef = React.useRef<HTMLDivElement>(null)
    const inputRef = React.useRef<HTMLInputElement>(null)

    const t = useTr()
    const wide = useWideScreen()

    const { mutate: sendChatMessage, isPending: isSending } = useNakamaSendChatMessage()

    // Auto-scroll to bottom when new messages arrive
    React.useEffect(() => {
        if (!minimized && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages, minimized])

    // Clear unread count when maximized
    React.useEffect(() => {
        if (!minimized) {
            setUnreadCount(0)
            // No keyboard popping up by itself on phones and tablets
            if (wide) inputRef.current?.focus()
        }
    }, [minimized])

    const handleSendMessage = () => {
        if (!inputValue.trim() || isSending) return
        inputRef.current?.focus()

        sendChatMessage({ message: inputValue.trim() }, {
            onSuccess: () => {
                setInputValue("")
                setTimeout(() => {
                    inputRef.current?.focus()
                }, 200)
            },
            onError: (error) => {
                console.error("Failed to send message:", error)
            },
        })
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSendMessage()
        }
    }

    // Don't show chat if there's no session or user is not a participant
    if (!watchPartySession || !isParticipant) return null

    if (!wide) {
        return <>
            <button type="button" className="nakama-chat-fab" onClick={() => setMinimized(false)} data-nakama-chat-open
                aria-label={unreadCount > 0 ? t(`Open watch party chat, ${unreadCount} new`, `Watch-Party-Chat öffnen, ${unreadCount} neu`) : t("Open watch party chat", "Watch-Party-Chat öffnen")}>
                <HiOutlineChatBubbleLeftRight aria-hidden />
                <span aria-hidden>Chat</span>
                {unreadCount > 0 && <span className="nakama-chat-unread" aria-hidden data-nakama-chat-unread>{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            <PhoneSheet title={t("Watch party chat", "Watch-Party-Chat")} open={!minimized} onOpenChange={(open) => setMinimized(!open)} data-nakama-chat-sheet>
                <div className="nk-chat">
                    <div className="nk-chat-messages" ref={chatContainerRef} aria-live="polite">
                        {messages.length === 0
                            ? <p className="nk-chat-empty">{t("No messages yet. Say hi to the others watching.", "Noch keine Nachrichten. Sag den anderen Hallo.")}</p>
                            : messages.map(msg => {
                                const own = msg.peerId === currentUserPeerId
                                return <div key={msg.messageId} className="nk-msg" data-own={own}>
                                    <div className="nk-msg-head">
                                        <b>{own ? t("Me", "Ich") : msg.username}{msg.peerId === "host" && !own ? " (Host)" : ""}</b>
                                        <time dateTime={msg.timestamp}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                                    </div>
                                    <p>{msg.message}</p>
                                </div>
                            })}
                        <div ref={messagesEndRef} />
                    </div>
                    <form className="nk-chat-form" onSubmit={event => {
                        event.preventDefault()
                        handleSendMessage()
                    }}>
                        <input ref={inputRef} value={inputValue} onChange={event => setInputValue(event.target.value)} disabled={isSending} autoComplete="off" enterKeyHint="send"
                            placeholder={t("Type a message…", "Nachricht schreiben …")} aria-label={t("Message", "Nachricht")} data-nakama-chat-input />
                        <button type="submit" className="ps-primary" disabled={!inputValue.trim() || isSending} aria-label={t("Send", "Senden")} data-nakama-chat-send>
                            <IoSend aria-hidden />
                        </button>
                    </form>
                </div>
            </PhoneSheet>
        </>
    }

    return (
        <div
            className={cn(
                "nakama-chat fixed bottom-4 left-20 z-[40] hidden lg:flex flex-col bg-gray-900 border rounded-xl shadow-2xl transition-all duration-300",
                minimized ? "w-64 h-14" : "w-[400px] h-[500px]",
            )}
        >
            <div
                className={cn(
                    "flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors rounded-t-lg",
                    minimized && "h-full",
                )}
                onClick={() => setMinimized(!minimized)}
            >
                <div className="flex items-center gap-2">
                    <HiOutlineChatBubbleLeftRight className="text-xl text-white" />
                    <span className="font-semibold text-sm">{tr("Watch party chat", "Watch-Party-Chat")}</span>
                    {minimized && unreadCount > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold w-5 flex justify-center items-center rounded-full animate-bounce shadow-lg">
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                    )}
                </div>
                <IconButton
                    icon={minimized ? <BiChevronUp /> : <BiChevronDown />}
                    intent="gray-basic"
                    size="xs"
                    onClick={(e) => {
                        e.stopPropagation()
                        setMinimized(!minimized)
                    }}
                />
            </div>

            {!minimized && (
                <ChatContent
                    messages={messages}
                    currentUserPeerId={currentUserPeerId}
                    messagesEndRef={messagesEndRef}
                    chatContainerRef={chatContainerRef}
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    handleKeyPress={handleKeyPress}
                    isSending={isSending}
                    inputRef={inputRef}
                    handleSendMessage={handleSendMessage}
                />
            )}
        </div>
    )
}

function ChatContent(props: {
    messages: ChatMessage[]
    currentUserPeerId: string | null | undefined
    messagesEndRef: React.RefObject<HTMLDivElement | null>
    chatContainerRef: React.RefObject<HTMLDivElement | null>
    inputValue: string
    setInputValue: (value: string) => void
    handleKeyPress: (e: React.KeyboardEvent) => void
    isSending: boolean
    inputRef: React.RefObject<HTMLInputElement | null>
    handleSendMessage: () => void
}) {
    const t = useTr()
    const {
        messages,
        currentUserPeerId,
        messagesEndRef,
        chatContainerRef,
        inputValue,
        setInputValue,
        handleKeyPress,
        isSending,
        inputRef,
        handleSendMessage,
    } = props

    function isHostMessage(msg: ChatMessage) {
        return msg.peerId === "host"
    }

    return (
        <>
            <div
                ref={chatContainerRef}
                className={cn(
                    "flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent",
                )}
            >
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-[--muted] text-sm">
                        {t("No messages yet", "Noch keine Nachrichten")}
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isOwnMessage = msg.peerId === currentUserPeerId
                        return (
                            <div
                                key={msg.messageId}
                                className={cn(
                                    "flex flex-col gap-1 p-2 rounded",
                                    isOwnMessage && "bg-gray-800",
                                )}
                            >
                                <div className="flex items-baseline justify-between gap-2">
                                    <span
                                        className={cn(
                                            "font-semibold text-sm tracking-wide",
                                            "text-white",
                                        )}
                                    >
                                        {isOwnMessage ? t("Me", "Ich") : msg.username}{isHostMessage(msg) && ` (${t("Host", "Host")})`}:{" "}
                                    </span>
                                    <span className="text-xs text-[--muted]">
                                        {new Date(msg.timestamp).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-200 break-words whitespace-pre-wrap">{msg.message}</p>
                            </div>
                        )
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-2">
                <div className="flex gap-2 items-center">
                    <TextInput
                        value={inputValue}
                        onValueChange={setInputValue}
                        onKeyDown={handleKeyPress}
                        placeholder={t("Type a message…", "Nachricht schreiben …")}
                        disabled={isSending}
                        className="flex-1 h-10"
                        size="sm"
                        ref={inputRef}
                        autoFocus
                        autoComplete="off"
                    />
                    <IconButton
                        icon={<IoSend />}
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || isSending}
                        intent="primary"
                        size="sm"
                        aria-label={t("Send", "Senden")}
                    />
                </div>
            </div>
        </>
    )
}
