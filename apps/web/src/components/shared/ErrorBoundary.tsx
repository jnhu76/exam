import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Props for the ErrorBoundary component. */
interface Props {
  children: ReactNode;
}

/** Internal state tracking caught errors and their component stack info. */
interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React error boundary that catches rendering errors and displays a
 * user-friendly error card with a reload button. Shows component stack
 * in development mode.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
  }

  handleReset = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-muted p-4">
          <Card className="max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-6 text-destructive" />
                <CardTitle>系统错误</CardTitle>
              </div>
              <CardDescription>应用程序遇到了一个意外错误</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {this.state.error?.message || "未知错误"}
                </p>
                {import.meta.env.DEV && this.state.errorInfo && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">查看详细信息</summary>
                    <pre className="mt-2 overflow-auto rounded bg-muted p-2">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={this.handleReset} className="w-full">
                <RefreshCw data-icon="inline-start" />
                重新加载
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
