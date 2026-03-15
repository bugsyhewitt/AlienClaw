package ai.alienclaw.app.ui

import androidx.compose.runtime.Composable
import ai.alienclaw.app.MainViewModel
import ai.alienclaw.app.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
