{{- define "agent-todo.name" -}}
agent-todo
{{- end }}

{{- define "agent-todo.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "agent-todo.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
