import React, { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, CalendarDays, Loader2, Clock, Tag, Globe } from "lucide-react";
import { toast } from "sonner";
import { listEvents, createEvent, deleteEvent } from "@/lib/api";
import { useSpace } from "@/context/SpaceContext";
import { localTimeZone, isoToLocalInput, localInputToUtcIso, formatDateTime, isExpired } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const localizer = dateFnsLocalizer({
  format, parse, startOfWeek, getDay, locales: { "en-US": enUS },
});

const CATEGORIES = ["Date Night", "Anniversary", "Trip", "Reminder", "Chore"];
const CATEGORY_COLORS = {
  "Date Night": "#E05D52",
  Anniversary: "#C94A40",
  Trip: "#8FA382",
  Reminder: "#D9A441",
  Chore: "#786C66",
};

const emptyForm = () => {
  const now = isoToLocalInput(new Date().toISOString());
  const later = isoToLocalInput(new Date(Date.now() + 3600000).toISOString());
  return { title: "", start: now, end: later, category: "Date Night", note: "" };
};

export default function CalendarPage() {
  const { code } = useSpace();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);

  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["events", code],
    queryFn: () => listEvents(code),
  });

  const createMut = useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", code] });
      toast.success("Event added \u2764");
      setOpen(false);
      setForm(emptyForm());
    },
    onError: () => toast.error("Could not add the event. Try again."),
  });

  const deleteMut = useMutation({
    mutationFn: deleteEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", code] });
      toast.success("Event removed");
      setSelected(null);
    },
    onError: () => toast.error("Could not delete the event."),
  });

  const calendarEvents = useMemo(
    () =>
      events.map((e) => ({
        ...e,
        title: e.title,
        start: new Date(e.start),
        end: new Date(e.end),
      })),
    [events]
  );

  const submit = () => {
    if (!form.title.trim()) return toast.error("Give your event a title");
    if (new Date(form.end) < new Date(form.start)) return toast.error("End time is before start time");
    createMut.mutate({
      code,
      title: form.title.trim(),
      start: localInputToUtcIso(form.start),
      end: localInputToUtcIso(form.end),
      category: form.category,
      note: form.note,
    });
  };

  const eventStyle = (event) => ({
    style: {
      backgroundColor: CATEGORY_COLORS[event.category] || "#E05D52",
      borderRadius: "8px",
      border: "none",
      color: "white",
      fontSize: "0.75rem",
      padding: "1px 6px",
      opacity: isExpired(event.end?.toISOString?.() || event.end) ? 0.5 : 1,
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-espresso">Your Calendar</h1>
          <p className="text-espresso/60 flex items-center gap-1.5 text-sm mt-1">
            <Globe className="h-3.5 w-3.5" /> Times shown in your timezone ({localTimeZone})
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              data-testid="calendar-add-event-button"
              className="h-11 rounded-xl bg-terra hover:bg-terra-dark text-white font-semibold"
            >
              <Plus className="h-5 w-5 mr-1" /> Add event
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="calendar-event-modal" className="rounded-2xl bg-white">
            <DialogHeader>
              <DialogTitle className="font-heading text-espresso">New event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="label-eyebrow text-terra">Title</Label>
                <Input
                  data-testid="calendar-event-title-input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Dinner date, Anniversary..."
                  className="rounded-xl border-oatline"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="label-eyebrow text-terra">Starts</Label>
                  <Input
                    data-testid="calendar-event-start-input"
                    type="datetime-local"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                    className="rounded-xl border-oatline"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="label-eyebrow text-terra">Ends</Label>
                  <Input
                    data-testid="calendar-event-end-input"
                    type="datetime-local"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                    className="rounded-xl border-oatline"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="label-eyebrow text-terra">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="calendar-event-category-select" className="rounded-xl border-oatline">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="label-eyebrow text-terra">Note</Label>
                <Textarea
                  data-testid="calendar-event-note-input"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Anything to remember?"
                  className="rounded-xl border-oatline resize-none"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                data-testid="calendar-event-submit-button"
                onClick={submit}
                disabled={createMut.isPending}
                className="w-full h-11 rounded-xl bg-terra hover:bg-terra-dark text-white font-semibold"
              >
                {createMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save event"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="h-[540px] flex items-center justify-center bg-white rounded-2xl border border-oatline">
          <Loader2 className="h-6 w-6 animate-spin text-terra" />
        </div>
      ) : isError ? (
        <div className="h-[400px] flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border border-oatline">
          <p className="text-espresso/60">Couldn't load your events.</p>
          <Button variant="outline" onClick={() => refetch()} className="rounded-xl">Retry</Button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-oatline p-3 sm:p-4" data-testid="calendar-grid">
          <Calendar
            localizer={localizer}
            events={calendarEvents}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 560 }}
            views={["month", "week", "day", "agenda"]}
            popup
            eventPropGetter={eventStyle}
            onSelectEvent={(ev) => setSelected(ev)}
          />
        </div>
      )}

      {/* Event detail / delete dialog */}
      <AlertDialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <AlertDialogContent className="rounded-2xl bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-espresso flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-terra" />
              {selected?.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-espresso/70 pt-2">
                <div className="flex items-center gap-2"><Tag className="h-4 w-4" /> {selected?.category}</div>
                <div className="flex items-center gap-2"><Clock className="h-4 w-4" /> {selected && formatDateTime(selected.start.toISOString())}</div>
                <div className="flex items-center gap-2"><Clock className="h-4 w-4 opacity-0" /> to {selected && formatDateTime(selected.end.toISOString())}</div>
                {selected?.note ? <p className="pt-1 text-espresso/80">{selected.note}</p> : null}
                {selected && isExpired(selected.end.toISOString()) ? (
                  <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-oat text-espresso/50">Past event</span>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Close</AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                data-testid="calendar-event-delete-button"
                onClick={() => selected && deleteMut.mutate(selected.id)}
                className="rounded-xl bg-terra hover:bg-terra-dark text-white inline-flex items-center px-4 py-2 font-semibold"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
