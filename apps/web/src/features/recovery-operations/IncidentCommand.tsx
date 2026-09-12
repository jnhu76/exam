import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { FieldError } from "@/components/shared/FieldError";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecoveryCommandDialog } from "@/features/recovery-operations/RecoveryCommandDialog";
import { useRecoveryOperation } from "@/features/recovery-operations/useRecoveryOperation";
import { Wrench } from "lucide-react";

/**
 * J5-I1C1 — one config-driven incident command dialog (investigate /
 * add_note / change_severity / resolve / dismiss / link_attempt).
 *
 * Every command mints ONE operationId per dialog session (reused on retry —
 * J5-R0 §8.2) and sends the incident's `version` as `expectedVersion` (all
 * commands except add_note, whose wire schema has no version field). A 409
 * `INCIDENT_VERSION_CONFLICT` surfaces the dedicated "reload and retry"
 * message; every confirmed outcome reloads the authoritative projection.
 *
 * Shared by the Admin Recovery incident detail and the Proctor Recovery
 * Center (EXAM-303): the component is authority-neutral — callers render it only
 * for actions the server already listed in `allowedActions`, and the endpoint
 * it posts to is the same canonical assignment-scoped incident command route.
 */
export interface IncidentCommandFieldBase {
  kind: "text" | "select";
  key: string;
  labelKey: string;
  maxLength?: number;
  options?: { value: string; labelKey: string }[];
}
/**
 * A required field MUST carry its required-error key (the validation path
 * renders the FieldError from it); non-required fields may omit it.
 */
export type IncidentCommandField =
  | (IncidentCommandFieldBase & { required: true; requiredErrorKey: string })
  | (IncidentCommandFieldBase & { required?: false; requiredErrorKey?: never });

export function IncidentCommand({
  incidentId,
  incidentVersion,
  endpoint,
  titleKey,
  description,
  confirmLabelKey,
  doneToastKey,
  destructive = false,
  versioned = true,
  fields,
  refresh,
}: {
  incidentId: string;
  incidentVersion: number;
  endpoint: string;
  titleKey: string;
  description: string;
  confirmLabelKey: string;
  doneToastKey: string;
  destructive?: boolean;
  versioned?: boolean;
  fields: IncidentCommandField[];
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const command = useRecoveryOperation({
    submit: (operationId) => {
      const body: Record<string, unknown> = { operationId };
      if (versioned) body.expectedVersion = incidentVersion;
      for (const field of fields) {
        const value = values[field.key]?.trim() ?? "";
        if (field.required || value.length > 0) body[field.key] = value;
      }
      return api.post(`/api/admin/incidents/${incidentId}${endpoint}`, body);
    },
    onSuccess: () => {
      toast.success(t(doneToastKey as never));
      setOpen(false);
      refresh();
    },
    onConfirmedRejection: (err) => {
      setOpen(false);
      if (err instanceof ApiError && err.code === "INCIDENT_VERSION_CONFLICT") {
        toast.error(t("admin.recoveryOps.versionConflict"));
      } else if (err instanceof ApiError) {
        toast.error(t("admin.recoveryOps.rejectionFailed"));
      } else {
        toast.error(t("admin.recoveryOps.indeterminate"));
      }
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  const invalid = fields.some(
    (field) => field.required && (values[field.key]?.trim() ?? "").length === 0,
  );
  const tooLong = fields.some(
    (field) =>
      field.maxLength != null &&
      (values[field.key]?.trim() ?? "").length > field.maxLength,
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Reset the draft ONLY when no command session is active — a frozen
          // command (retry) must never have its payload replaced by a reset.
          if (command.phase === "idle" && command.operationId === null) {
            setValues({});
          }
          setOpen(true);
          command.begin();
        }}
        disabled={command.phase === "submitting"}
      >
        <AppIcon icon={Wrench} size="inline" className="mr-1" />
        {t(titleKey as never)}
      </Button>
      <RecoveryCommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t(titleKey as never)}
        description={description}
        confirmLabel={t(confirmLabelKey as never)}
        confirmDisabled={invalid || tooLong}
        destructive={destructive}
        submitting={command.phase === "submitting"}
        indeterminate={command.phase === "indeterminate"}
        onConfirm={() => void command.run()}
      >
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-2">
            <Label htmlFor={`recovery-incident-${field.key}`}>
              {t(field.labelKey as never)}
            </Label>
            {field.kind === "select" ? (
              <Select
                value={values[field.key] ?? ""}
                onValueChange={(v) =>
                  setValues((prev) => ({ ...prev, [field.key]: v }))
                }
              >
                <SelectTrigger id={`recovery-incident-${field.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Textarea
                id={`recovery-incident-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
              />
            )}
            {field.required &&
              (values[field.key]?.trim() ?? "").length === 0 && (
                <FieldError>{t(field.requiredErrorKey as never)}</FieldError>
              )}
            {field.maxLength != null &&
              (values[field.key]?.trim() ?? "").length > field.maxLength && (
                <FieldError>
                  {t("admin.recoveryOps.reasonTooLong", {
                    count: field.maxLength,
                  })}
                </FieldError>
              )}
          </div>
        ))}
      </RecoveryCommandDialog>
    </>
  );
}

/**
 * Renders a structured top-level key/value summary of an event payload.
 * `payload` is `unknown` on the wire — never dump it as a raw JSON blob;
 * present only plain top-level entries (nested values are compacted).
 */
export function PayloadSummary({ payload }: { payload: unknown }) {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 type-metadata">
      {entries.map(([key, value]) => (
        <span key={key}>
          {key}:{" "}
          {value != null && typeof value === "object"
            ? JSON.stringify(value)
            : String(value)}
        </span>
      ))}
    </span>
  );
}
