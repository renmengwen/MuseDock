import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('编辑器错误:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="one-click-editor-error-boundary">
          <h3>编辑器发生错误</h3>
          <p>{this.state.error?.message || '未知错误'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
