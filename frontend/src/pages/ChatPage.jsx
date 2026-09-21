import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, MessageCircle, Loader2 } from "lucide-react";
import { listMessages, createMessage } from "@/lib/api";
import { useSpace } from "@/context/SpaceContext";
import { formatTime } from "@/lib/time";
import { Input } from "@/components/ui/input";

export default function ChatPage() {
  const { code, deviceId } = useSpace();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", code],
    queryFn: () => listMessages(code),
    refetchInterval: 3000,
  });

  const sendMut = useMutation({
    mutationFn: createMessage,
    onMutate: () => setText(""),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", code] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendMut.mutate({ code, sender: deviceId, text: t });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] sm:h-[calc(100vh-14rem)]">
      <div className="mb-3">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-espresso">Chat</h1>
        <p className="text-espresso/60 text-sm mt-1">Say hi to your other half.</p>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-oatline p-4 space-y-3">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-terra" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-espresso/50 gap-2">
            <MessageCircle className="h-10 w-10 text-terra/40" />
            <p>No messages yet. Start the conversation \u2764</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender === deviceId;
            return (
              <div
                key={m.id}
                data-testid="chat-message-item"
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2 rounded-2xl ${
                    mine
                      ? "bg-terra text-white rounded-tr-sm"
                      : "bg-oat text-espresso rounded-tl-sm"
                  }`}
                >
                  <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
                  <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-espresso/40"}`}>
                    {formatTime(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          data-testid="chat-message-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message..."
          className="h-12 rounded-xl border-oatline"
        />
        <button
          data-testid="chat-send-button"
          onClick={send}
          disabled={!text.trim()}
          className="h-12 w-12 shrink-0 rounded-xl bg-terra hover:bg-terra-dark text-white flex items-center justify-center disabled:opacity-40 transition-colors"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
