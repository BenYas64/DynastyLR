import { Component } from 'react'

// Must be a class component - React only supports catching render errors
// via getDerivedStateFromError/componentDidCatch, there's no hook for it.
// Wraps the routed pages (not the nav) in App.jsx, keyed by the current
// path, so a bug on one page shows an error here instead of crashing the
// entire app (nav still works, since it's outside this boundary), and
// navigating to any other page - including back to the same broken one
// after a fix - gets a fresh boundary instead of staying stuck.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px 20px', fontFamily: 'sans-serif', textAlign: 'center' }}>
          <h2>Something went wrong loading this page.</h2>
          <p style={{ color: '#666' }}>{this.state.error.message}</p>
          <p style={{ color: '#666' }}>Try another page from the menu above.</p>
        </div>
      )
    }
    return this.props.children
  }
}
