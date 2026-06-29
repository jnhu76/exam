import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import type { UpdateBrandingRequest } from "@exam/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";

/** Available timezone options for the platform settings form. */
const TIMEZONE_OPTIONS = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

/** Form values type derived from the branding update contract. */
export type SettingsFormValues = UpdateBrandingRequest;

/**
 * Form for editing platform branding settings: product title, subtitle,
 * footer, organization display name, and default timezone.
 */
export function PlatformSettingsForm({
  initialValues,
  onSave,
  isLoading,
}: {
  initialValues?: SettingsFormValues;
  onSave: (data: SettingsFormValues) => void;
  isLoading?: boolean;
}) {
  const { t } = useTranslation();
  const { register, handleSubmit, setValue, watch, reset } =
    useForm<SettingsFormValues>({
      defaultValues: {},
    });

  useEffect(() => {
    if (initialValues) {
      reset(initialValues);
    }
  }, [initialValues, reset]);

  const timezoneValue = watch("timezone");

  return (
    <form onSubmit={handleSubmit(onSave)} className="max-w-xl">
      <FieldGroup>
        <Field>
          <Label htmlFor="productName">
            {t("admin.platformSettings.productName")}
          </Label>
          <Input
            id="productName"
            placeholder={t("admin.platformSettings.productNamePlaceholder")}
            {...register("productName")}
          />
        </Field>
        <Field>
          <Label htmlFor="productSubtitle">
            {t("admin.platformSettings.productSubtitle")}
          </Label>
          <Input
            id="productSubtitle"
            placeholder={t("admin.platformSettings.productSubtitlePlaceholder")}
            {...register("productSubtitle")}
          />
        </Field>
        <Field>
          <Label htmlFor="footerText">
            {t("admin.platformSettings.footerText")}
          </Label>
          <Input
            id="footerText"
            placeholder={t("admin.platformSettings.footerTextPlaceholder")}
            {...register("footerText")}
          />
        </Field>
        <Field>
          <Label htmlFor="organizationDisplayName">
            {t("admin.platformSettings.orgDisplayName")}
          </Label>
          <Input
            id="organizationDisplayName"
            placeholder={t("admin.platformSettings.orgDisplayNamePlaceholder")}
            {...register("organizationDisplayName")}
          />
        </Field>
        <Field>
          <Label>{t("admin.platformSettings.defaultTimezone")}</Label>
          <Select
            value={timezoneValue ?? ""}
            onValueChange={(val) => setValue("timezone", val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t("admin.platformSettings.timezonePlaceholder")}
              />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button type="submit" disabled={isLoading}>
          {isLoading
            ? t("admin.platformSettings.actions.saving")
            : t("admin.platformSettings.actions.save")}
        </Button>
      </FieldGroup>
    </form>
  );
}
