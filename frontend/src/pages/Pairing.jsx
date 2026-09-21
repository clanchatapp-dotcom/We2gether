import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Heart, Copy, Check, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createSpace, getSpace } from "@/lib/api";
import { useSpace } from "@/context/SpaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Pairing() {
  const { setCode } = useSpace();
  const [generated, setGenerated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [joinValue, setJoinValue] = useState("");

  const createMut = useMutation({
    mutationFn: createSpace,
    onSuccess: (data) => {
      setGenerated(data.code);
      toast.success("Your space is ready — share the code!");
    },
    onError: () => toast.error("Could not create a space. Try again."),
  });

  const joinMut = useMutation({
    mutationFn: (code) => getSpace(code),
    onSuccess: (data) => {
      toast.success("Connected! Welcome to your space \u2764");
      setCode(data.code);
    },
    onError: () => toast.error("That code doesn't exist. Double-check it."),
  });

  const copyCode = async () => {
    await navigator.clipboard.writeText(generated);
    setCopied(true);
    toast.success("Code copied to clipboard");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen w-full bg-linen flex flex-col items-center justify-center p-5 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-terra/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sage/20 blur-3xl" />

      <div className="w-full max-w-md relative">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-terra flex items-center justify-center shadow-lg shadow-terra/30 mb-4 rotate-3">
            <Heart className="h-8 w-8 text-white" fill="white" />
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-espresso">We2gether</h1>
          <p className="text-espresso/60 mt-2 max-w-xs">
            One shared space for two. Plan moments, chat, and keep your memories side by side.
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-oatline p-6 shadow-xl shadow-espresso/5">
          {!generated ? (
            <>
              <div className="flex items-center gap-2 mb-3 text-terra">
                <Sparkles className="h-4 w-4" />
                <span className="label-eyebrow">Start a new space</span>
              </div>
              <Button
                data-testid="pairing-create-code-button"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                className="w-full h-12 rounded-xl bg-terra hover:bg-terra-dark text-white text-base font-semibold"
              >
                {createMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create a pairing code"}
              </Button>
            </>
          ) : (
            <div className="text-center">
              <span className="label-eyebrow text-terra">Your pairing code</span>
              <div
                data-testid="pairing-code-display"
                className="mt-3 text-4xl font-bold font-heading tracking-[0.3em] text-espresso bg-oat rounded-2xl py-5 select-all"
              >
                {generated}
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  data-testid="pairing-copy-button"
                  variant="outline"
                  onClick={copyCode}
                  className="flex-1 h-11 rounded-xl border-oatline"
                >
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  data-testid="pairing-enter-space-button"
                  onClick={() => setCode(generated)}
                  className="flex-1 h-11 rounded-xl bg-terra hover:bg-terra-dark text-white"
                >
                  Enter space <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
              <p className="text-xs text-espresso/50 mt-3 animate-pulse">
                Share this code with your partner so they can join.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-oatline" />
            <span className="text-xs text-espresso/40 uppercase tracking-widest">or</span>
            <div className="h-px flex-1 bg-oatline" />
          </div>

          <div className="flex items-center gap-2 mb-3 text-sage-dark">
            <Heart className="h-4 w-4" />
            <span className="label-eyebrow">Join your partner</span>
          </div>
          <div className="flex gap-2">
            <Input
              data-testid="pairing-code-input"
              value={joinValue}
              onChange={(e) => setJoinValue(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ENTER CODE"
              maxLength={6}
              className="h-12 rounded-xl border-oatline text-center text-lg tracking-[0.2em] font-semibold uppercase"
            />
            <Button
              data-testid="pairing-join-button"
              onClick={() => joinValue && joinMut.mutate(joinValue)}
              disabled={joinMut.isPending || joinValue.length < 4}
              className="h-12 px-5 rounded-xl bg-espresso hover:bg-espresso/90 text-white"
            >
              {joinMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Connect"}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-espresso/40 mt-6">No account needed. Just a code between the two of you.</p>
      </div>
    </div>
  );
}
