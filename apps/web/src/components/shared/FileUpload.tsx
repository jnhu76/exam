import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

/** Hidden file input that reads a CSV file and passes its text content to onText. */
export function FileUpload({ onText }: { onText: (text: string) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(onText);
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => input.current?.click()}
      >
        <Upload data-icon="inline-start" />
        {t("admin.importWizard.selectCsv")}
      </Button>
    </>
  );
}
