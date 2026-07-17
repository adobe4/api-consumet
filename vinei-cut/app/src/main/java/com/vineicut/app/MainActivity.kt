package com.vineicut.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vineicut.app.ui.align.BulkAlignScreen
import com.vineicut.app.ui.editor.EditorScreen
import com.vineicut.app.ui.home.HomeScreen
import com.vineicut.app.ui.theme.VineiCutTheme
import com.vineicut.app.vm.EditorViewModel

enum class Screen { HOME, EDITOR, BULK_ALIGN }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { VineiCutRoot() }
    }
}

@Composable
private fun VineiCutRoot() {
    VineiCutTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            val vm: EditorViewModel = viewModel()
            var screen by rememberSaveable { mutableStateOf(Screen.HOME) }

            when (screen) {
                Screen.HOME -> HomeScreen(
                    onNewProject = { vm.newProject(); screen = Screen.EDITOR },
                    onBulkAlign = { screen = Screen.BULK_ALIGN }
                )
                Screen.EDITOR -> EditorScreen(
                    vm = vm,
                    onBack = { screen = Screen.HOME },
                    onOpenBulkAlign = { screen = Screen.BULK_ALIGN }
                )
                Screen.BULK_ALIGN -> BulkAlignScreen(
                    vm = vm,
                    onDone = { screen = Screen.EDITOR },
                    onBack = { screen = if (vm.project.durationMs > 0) Screen.EDITOR else Screen.HOME }
                )
            }
        }
    }
}
