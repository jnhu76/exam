import { useForm } from "react-hook-form";
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

export interface SettingsFormValues {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
}

export function PlatformSettingsForm({
  defaultValues,
  onSave,
  isLoading,
}: {
  defaultValues: SettingsFormValues;
  onSave: (data: SettingsFormValues) => void;
  isLoading?: boolean;
}) {
  const { register, handleSubmit, setValue, watch } =
    useForm<SettingsFormValues>({
      defaultValues,
    });

  const timezoneValue = watch("timezone");

  return (
    <form onSubmit={handleSubmit(onSave)} className="max-w-xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="productName">产品标题</Label>
        <Input id="productName" {...register("productName")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="productSubtitle">产品副标题</Label>
        <Input id="productSubtitle" {...register("productSubtitle")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="footerText">页脚说明</Label>
        <Input id="footerText" {...register("footerText")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="organizationDisplayName">机构显示名</Label>
        <Input
          id="organizationDisplayName"
          {...register("organizationDisplayName")}
        />
      </div>
      <div className="space-y-2">
        <Label>默认时区</Label>
        <Select
          value={timezoneValue}
          onValueChange={(val) => setValue("timezone", val)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "保存中..." : "保存设置"}
      </Button>
    </form>
  );
}
