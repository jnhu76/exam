import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useBranding } from "@/components/layout/BrandProvider";

export function LoginPage() {
  const branding = useBranding();

  return (
    <main
      data-testid="login-layout"
      className="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandHeader />
        </CardHeader>
        <CardContent>
          {branding.productSubtitle && (
            <p className="text-sm text-muted-foreground">
              {branding.productSubtitle}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
