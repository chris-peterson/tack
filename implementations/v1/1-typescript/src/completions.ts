export const ZSH_COMPLETION = `#compdef tack

_tack_routes() {
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  [[ -d "$tack_dir" ]] || return
  local -a routes
  routes=( "$tack_dir"/*.yaml(N:t:r) )
  (( \${#routes} )) && compadd -a routes
}

_tack_tack_ids() {
  local slug="$1"
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  local route_file="$tack_dir/$slug.yaml"
  [[ -f "$route_file" ]] || return
  local -a ids
  ids=( \${(f)"$(grep -E '^  - id: ' "$route_file" | sed 's/^  - id: //')"} )
  (( \${#ids} )) && compadd -a ids
}

_tack_todo_ids() {
  local slug="$1" tack_id="$2"
  local tack_dir="\${TACK_HOME:-$HOME/.tack}/routes"
  local route_file="$tack_dir/$slug.yaml"
  [[ -f "$route_file" ]] || return
  local -a ids
  ids=( \${(f)"$(awk -v tid="$tack_id" '
    /^  - id: / { current = $3 }
    current == tid && /^      - id: [ab][0-9]/ { print $3 }
  ' "$route_file")"} )
  (( \${#ids} )) && compadd -a ids
}

_tack() {
  local -a commands
  commands=(
    'init:Create a new route'
    'status:Show route status'
    'list:List all routes'
    'add:Add a tack to a route'
    'start:Start working on a tack'
    'done:Mark a tack as done'
    'drop:Drop a tack'
    'deliverable:Set a deliverable on a tack'
    'before:Add a pre-work todo'
    'after:Add a post-work todo'
    'todo:Manage todo items'
    'link:Add a link to a tack'
    'session:Record a session'
    'rm:Remove a route'
    'completions:Output shell completion script'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  local command="\${words[2]}"

  case "$command" in
    init)
      # tack init <slug> [--tangent] [--group <slug>]
      case "$CURRENT" in
        3) _message 'slug' ;;
        *) _arguments '--tangent[Create as tangent]' '--group[Group slug]:group:_tack_routes' ;;
      esac
      ;;
    status)
      # tack status [slug] [--json]
      case "$CURRENT" in
        3) _tack_routes; _arguments '--json[Output JSON]' ;;
        *) _arguments '--json[Output JSON]' ;;
      esac
      ;;
    list)
      # tack list [--json]
      _arguments '--json[Output JSON]'
      ;;
    add)
      # tack add <slug> <summary> [--depends-on <id,...>]
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _message 'summary' ;;
        *) _arguments '--depends-on[Comma-separated tack IDs]:depends' ;;
      esac
      ;;
    start|done|drop)
      # tack {start|done|drop} <slug> <tack-id>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
      esac
      ;;
    deliverable)
      # tack deliverable <slug> <tack-id> <label> <url>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'label' ;;
        6) _message 'url' ;;
      esac
      ;;
    before|after)
      # tack {before|after} <slug> <tack-id> <text>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'text' ;;
      esac
      ;;
    todo)
      # tack todo {done|drop} <slug> <tack-id> <todo-id>
      case "$CURRENT" in
        3) local -a subcmds; subcmds=('done:Complete a todo' 'drop:Drop a todo'); _describe 'subcommand' subcmds ;;
        4) _tack_routes ;;
        5) _tack_tack_ids "\${words[4]}" ;;
        6) _tack_todo_ids "\${words[4]}" "\${words[5]}" ;;
      esac
      ;;
    link)
      # tack link <slug> <tack-id> <label> <url>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _tack_tack_ids "\${words[3]}" ;;
        5) _message 'label' ;;
        6) _message 'url' ;;
      esac
      ;;
    session)
      # tack session <slug> <session-id>
      case "$CURRENT" in
        3) _tack_routes ;;
        4) _message 'session-id' ;;
      esac
      ;;
    rm)
      # tack rm <slug> [--force]
      case "$CURRENT" in
        3) _tack_routes ;;
        *) _arguments '--force[Skip confirmation]' ;;
      esac
      ;;
    completions)
      # tack completions <shell>
      case "$CURRENT" in
        3) compadd zsh ;;
      esac
      ;;
  esac
}

_tack "$@"
`;
