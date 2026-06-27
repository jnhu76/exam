import { useCallback } from "react";
import { toast } from "sonner";

export function useCopyToClipboard() {
  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!text && text !== "0") {
      toast.warning("复制内容为空");
      return false;
    }

    const textToCopy = text.toString();

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
        toast.success("已复制到剪贴板");
        return true;
      }
    } catch {
      // fallback below
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = textToCopy;
      textarea.style.position = "fixed";
      textarea.style.left = "-999999px";
      textarea.style.top = "-999999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (ok) {
        toast.success("已复制到剪贴板");
        return true;
      }
    } catch {
      // fall through
    }

    toast.error("复制失败，请手动复制");
    return false;
  }, []);

  return copy;
}
