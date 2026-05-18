import { Link, NavLink, Route, Routes, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { fetchApi, getSiteId } from './api'

function useEndpoint(path, query = '') {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  useEffect(() => {
    let active = true
    setState({ loading: true, error: '', data: null })

    fetchApi(path, query)
      .then((data) => {
        if (active) setState({ loading: false, error: '', data })
      })
      .catch((error) => {
        if (active) setState({ loading: false, error: error.message, data: null })
      })

    return () => {
      active = false
    }
  }, [path, query])

  return state
}

function Shell({ children }) {
  const nav = [
    ['/', 'Home'],
    ['/posts', 'Posts'],
    ['/stories', 'Stories'],
    ['/galleries', 'Galleries'],
    ['/images', 'Images'],
    ['/search', 'Search']
  ]

  return (
    <div className="shell">
      <header>
        <h1><Link to="/">sysop71</Link></h1>
        <p>Site ID: {getSiteId()}</p>
        <nav>
          {nav.map(([href, label]) => (
            <NavLink key={href} to={href} end={href === '/'}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}

function LoadingOrError({ loading, error }) {
  if (loading) return <p>Loading…</p>
  if (error) return <p className="error">{error}</p>
  return null
}

function HomePage() {
  const state = useEndpoint('home')
  if (state.loading || state.error) {
    return <LoadingOrError loading={state.loading} error={state.error} />
  }

  return (
    <section>
      <h2>{state.data?.site?.title || 'Home'}</h2>
      <p>Powered by the shared API route pattern: /api/{{siteid}}/...</p>
      <pre>{JSON.stringify(state.data, null, 2)}</pre>
    </section>
  )
}

function ListPage({ title, endpoint }) {
  const state = useEndpoint(endpoint)
  if (state.loading || state.error) {
    return <LoadingOrError loading={state.loading} error={state.error} />
  }

  const items = state.data?.items || state.data?.[endpoint] || []

  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.post_id || item.id || item.slug}>
            <strong>{item.title || item.slug}</strong>
            {item.summary ? <p>{item.summary}</p> : null}
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p>No items returned.</p> : null}
    </section>
  )
}

function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const query = useMemo(() => (q ? `?q=${encodeURIComponent(q)}` : ''), [q])
  const state = useEndpoint('search', query)

  return (
    <section>
      <h2>Search</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setParams({ q: String(form.get('q') || '') })
        }}
      >
        <input name="q" defaultValue={q} placeholder="Search" />
        <button type="submit">Go</button>
      </form>
      <LoadingOrError loading={state.loading} error={state.error} />
      {!state.loading && !state.error ? <pre>{JSON.stringify(state.data, null, 2)}</pre> : null}
    </section>
  )
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/posts" element={<ListPage title="Posts" endpoint="posts" />} />
        <Route path="/stories" element={<ListPage title="Stories" endpoint="stories" />} />
        <Route path="/galleries" element={<ListPage title="Galleries" endpoint="galleries" />} />
        <Route path="/images" element={<ListPage title="Images" endpoint="images" />} />
        <Route path="/search" element={<SearchPage />} />
      </Routes>
    </Shell>
  )
}
