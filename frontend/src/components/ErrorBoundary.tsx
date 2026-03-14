import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unknown error",
    };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <h1 className="text-xl font-semibold mb-2">页面渲染失败</h1>
            <p className="text-sm text-muted-foreground break-words">{this.state.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
